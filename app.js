function storageKey(name) {
  const prefix = AUTH.username || "saldanli";
  const map = {
    vocabulary: `yds-vocab-items-${prefix}`,
    progress: `yds-vocab-progress-${prefix}`,
    daily: `yds-vocab-daily-${prefix}`,
    snapshot: `yds-vocab-study-snapshot-${prefix}`,
    auth: `yds-vocab-auth`,          // global: who is logged in
    theme: `yds-vocab-theme`,         // global: theme preference
  };
  return map[name];
}

// Legacy key support (migrate old data if found)
const LEGACY_STORAGE_KEYS = {
  vocabulary: "yds-vocab-items",
  progress: "yds-vocab-progress",
  daily: "yds-vocab-daily",
  snapshot: "yds-vocab-study-snapshot",
};

const USERS = {
  saldanli: {
    username: "saldanli",
    displayName: "Arif SALDANLI",
    password: "21542154",
    gender: "male",
    databasePath: "yds-vocabulary/saldanli",
  },
  sevcan: {
    username: "sevcan",
    displayName: "Sevcan YILMAZ SALDANLI",
    password: "031212",
    gender: "female",
    databasePath: "yds-vocabulary/sevcan",
  },
};

// AUTH alias — set dynamically when a user logs in
let AUTH = { username: "saldanli", password: "21542154" };

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyC48zpV-bhFVoP6cNx9IGunljVk7_xyHAw",
  authDomain: "soru-takip-uygulamasi.firebaseapp.com",
  databaseURL: "https://soru-takip-uygulamasi-default-rtdb.firebaseio.com",
  projectId: "soru-takip-uygulamasi",
  storageBucket: "soru-takip-uygulamasi.firebasestorage.app",
  messagingSenderId: "716938527262",
  appId: "1:716938527262:web:2e252a594e0e3df8f0640f",
};

const sampleCsv = `No,S\u00f6zc\u00fck,T\u00fcrk\u00e7e Kar\u015f\u0131l\u0131\u011f\u0131
1,immature,olgunla\u015fmam\u0131\u015f
2,abandon,terk etmek
3,accurate,do\u011fru veya kesin
4,allocate,tahsis etmek
5,consequence,sonu\u00e7
6,enhance,geli\u015ftirmek
7,inevitable,ka\u00e7\u0131n\u0131lmaz
8,retain,ak\u0131lda tutmak`;

let vocabulary = [];
let progress = {};
let daily = {};
let activeView = "dashboard";
let cardMode = "all";      // Kartlar modu: "all" | "difficult"
let quizMode = "all";      // Quiz modu:    "all" | "difficult"
let matchMode = "all";     // Eşleştir modu:"all" | "difficult"
let currentCard = null;
// Session buffer: prevents recently-shown cards from appearing again too soon
let recentCardIds = [];        // genel "son görülen" tamponu
let wrongCooldownIds = [];     // yanlış cevaplanmış kelimeler için uzun bekleme listesi
const RECENT_BUFFER_SIZE = 20; // son 20 kart tekrar gelmesin
const WRONG_COOLDOWN_SIZE = 40; // yanlış cevaplanan kart 40 kart sonra geri gelsin
let currentQuiz = null;
let selectedMatchWord = null;
let selectedMatchMeaning = null;
let quizAdvanceTimer = null;
let draggedMatchId = null;
let currentMatchIds = new Set();
let cardPointer = null;
let cloudSaveTimer = null;
let cloudSyncInProgress = false;
let cloudDb = null;
let cloudRef = null;
let cloudListenerAttached = false;
let applyingRemoteData = false;
let lastResetAt = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  requestPersistentStorage();
  applyTheme();

  // Always start with user selection — no auto-login
  sessionStorage.removeItem("yds-vocab-auth");
  showUserSelection();
  applyAuthState();
  renderAll();
});

function loadUserData() {
  // Reset Firebase connection so it re-initializes with the new user's path
  detachCloudListener();
  cloudDb = null;
  cloudRef = null;
  cloudListenerAttached = false;
  cloudSyncInProgress = false;

  // Migrate legacy keys for saldanli if new keys are empty
  if (AUTH.username === "saldanli") {
    if (!localStorage.getItem(storageKey("vocabulary")) && localStorage.getItem(LEGACY_STORAGE_KEYS.vocabulary)) {
      localStorage.setItem(storageKey("vocabulary"), localStorage.getItem(LEGACY_STORAGE_KEYS.vocabulary));
      localStorage.setItem(storageKey("progress"), localStorage.getItem(LEGACY_STORAGE_KEYS.progress) || "{}");
      localStorage.setItem(storageKey("daily"), localStorage.getItem(LEGACY_STORAGE_KEYS.daily) || "{}");
    }
  }
  vocabulary = loadJson(storageKey("vocabulary"), []);
  progress = loadJson(storageKey("progress"), {});
  daily = loadJson(storageKey("daily"), {});
  recentCardIds = [];
  wrongCooldownIds = [];
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return;
  try {
    await navigator.storage.persist();
  } catch {
    // Best effort only; the app still works with normal localStorage.
  }
}

window.addEventListener("pagehide", () => {
  saveStudyData();
});

function bindEvents() {
  // User selection login
  $$(".user-card").forEach((card) => {
    card.addEventListener("click", () => selectUser(card.dataset.username));
  });
  $("#passwordStep").addEventListener("submit", handlePasswordSubmit);
  $("#backToUsers").addEventListener("click", showUserSelection);
  // Hamburger menu
  $("#hamburgerButton").addEventListener("click", toggleMobileMenu);
  document.addEventListener("click", closeMobileMenuOnOutsideClick);
  // Mirror desktop buttons → mobile menu buttons
  $("#themeButtonM").addEventListener("click", () => { toggleTheme(); closeMobileMenu(); });
  $("#focusButtonM").addEventListener("click", () => { openFocusMode(); closeMobileMenu(); });
  $("#exportButtonM").addEventListener("click", () => { exportProgress(); closeMobileMenu(); });
  $("#logoutButtonM").addEventListener("click", () => { logout(); closeMobileMenu(); });
  $("#resetButtonM").addEventListener("click", () => { openResetModal(); closeMobileMenu(); });
  $("#themeButton").addEventListener("click", toggleTheme);
  $("#logoutButton").addEventListener("click", logout);
  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $$(".mode-button[data-section='cards']").forEach((button) => {
    button.addEventListener("click", () => {
      cardMode = button.dataset.mode;
      $$(".mode-button[data-section='cards']").forEach((b) => b.classList.toggle("active", b === button));
      recentCardIds = [];
      wrongCooldownIds = [];
      nextCard();
    });
  });

  $$(".mode-button[data-section='quiz']").forEach((button) => {
    button.addEventListener("click", () => {
      quizMode = button.dataset.mode;
      $$(".mode-button[data-section='quiz']").forEach((b) => b.classList.toggle("active", b === button));
      nextQuiz();
    });
  });

  $$(".mode-button[data-section='match']").forEach((button) => {
    button.addEventListener("click", () => {
      matchMode = button.dataset.mode;
      $$(".mode-button[data-section='match']").forEach((b) => b.classList.toggle("active", b === button));
      newMatchSet();
    });
  });

  $("#fileInput").addEventListener("change", handleFileUpload);
  $("#urlForm").addEventListener("submit", handleUrlLoad);
  $("#sampleButton").addEventListener("click", () => importVocabulary(sampleCsv, "\u00d6rnek kelime listesi y\u00fcklendi."));
  $("#resetButton").addEventListener("click", openResetModal);
  $("#resetModalCancel").addEventListener("click", closeResetModal);
  $("#resetProgressOnly").addEventListener("click", handleResetProgressOnly);
  $("#resetEverything").addEventListener("click", handleResetEverything);
  $("#focusButton").addEventListener("click", openFocusMode);
  $("#focusModalClose").addEventListener("click", closeFocusMode);
  $("#focusReveal").addEventListener("click", focusReveal);
  $("#focusWrong").addEventListener("click", () => focusAnswer(false));
  $("#focusRight").addEventListener("click", () => focusAnswer(true));
  $("#exportButton").addEventListener("click", exportProgress);
  $("#startReviewButton").addEventListener("click", () => {
    cardMode = "due";
    switchView("flashcards");
    nextCard();
  });

  $("#flashcard").addEventListener("pointerdown", startCardPointer);
  $("#flashcard").addEventListener("pointermove", moveCardPointer);
  $("#flashcard").addEventListener("pointerup", endCardPointer);
  $("#flashcard").addEventListener("pointercancel", cancelCardPointer);
  $("#revealButton").addEventListener("click", revealCard);
  $("#wrongButton").addEventListener("click", () => {
    const card = $("#flashcard");
    card.style.transition = "transform 180ms ease";
    card.style.transform = "translateX(-260px) translateY(-90px) rotate(-14deg)";
    window.setTimeout(() => { card.style.transition = ""; answerCard(false); }, 170);
  });
  $("#rightButton").addEventListener("click", () => {
    const card = $("#flashcard");
    card.style.transition = "transform 180ms ease";
    card.style.transform = "translateX(260px) translateY(-90px) rotate(14deg)";
    window.setTimeout(() => { card.style.transition = ""; answerCard(true); }, 170);
  });
  $("#nextQuizButton").addEventListener("click", nextQuiz);
  $("#newMatchButton").addEventListener("click", newMatchSet);
  $("#searchInput").addEventListener("input", renderWords);
  $("#statusFilter").addEventListener("change", renderWords);
  document.addEventListener("keydown", handleKeyboardShortcuts);
}

async function handleLogin(selectedUsername) {
  const user = USERS[selectedUsername];
  if (!user) {
    return false;
  }

  // 1. Set auth immediately
  AUTH = { username: user.username, password: user.password };
  sessionStorage.setItem("yds-vocab-auth", user.username);

  // 2. Load local data
  loadUserData();
  restoreStudyDataIfNeeded();

  // 3. Show the app right away — don't wait for cloud
  $("#loginScreen").classList.add("hidden");
  document.body.classList.remove("is-locked");
  updateSyncStatus();
  renderAll();

  // 4. Sync in the background (non-blocking)
  syncFromCloud().then(renderAll).catch(() => {});

  return true;
}

function logout() {
  detachCloudListener();
  cloudDb = null;
  cloudRef = null;
  cloudListenerAttached = false;
  cloudSyncInProgress = false;
  sessionStorage.removeItem("yds-vocab-auth");
  vocabulary = [];
  progress = {};
  daily = {};
  recentCardIds = [];
  wrongCooldownIds = [];
  AUTH = { username: "", password: "" };
  applyAuthState();
  showUserSelection();
}

function applyAuthState() {
  const isLoggedIn = Boolean(sessionStorage.getItem("yds-vocab-auth"));
  $("#loginScreen").classList.toggle("hidden", isLoggedIn);
  document.body.classList.toggle("is-locked", !isLoggedIn);
  updateSyncStatus();
}

// ── Multi-user login UI ──────────────────────────────────
let pendingLoginUsername = null;

function showUserSelection() {
  $("#userSelectionStep").classList.remove("hidden");
  $("#passwordStep").classList.add("hidden");
  pendingLoginUsername = null;
}

function selectUser(username) {
  const user = USERS[username];
  if (!user) return;
  // Doğrudan giriş yap — şifre sorma
  handleLogin(username);
}

async function handlePasswordSubmit(event) {
  event.preventDefault();
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(storageKey("theme"), nextTheme);
  applyTheme();
}

function applyTheme() {
  const savedTheme = localStorage.getItem(storageKey("theme"));
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const theme = savedTheme || (prefersDark ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  document.querySelector("meta[name='theme-color']")?.setAttribute("content", theme === "dark" ? "#000000" : "#151515");
  const label = theme === "dark" ? "Gunduz Modu" : "Gece Modu";
  if ($("#themeButton")) $("#themeButton").textContent = label;
}

function handleKeyboardShortcuts(event) {
  if (activeView !== "flashcards" || !currentCard) return;
  if (event.target.matches("input, textarea, select")) return;

  if (event.key === "ArrowRight") {
    event.preventDefault();
    animateKeyboardSwipe("right");
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    animateKeyboardSwipe("left");
  }
}

function animateKeyboardSwipe(direction) {
  const card = $("#flashcard");
  const isRight = direction === "right";
  card.classList.add(isRight ? "swiping-right" : "swiping-left");
  card.style.transform = `translateX(${isRight ? 160 : -160}px) translateY(-60px) rotate(${isRight ? 12 : -12}deg)`;
  window.setTimeout(() => {
    answerCard(isRight);
  }, 180);
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function saveStudyData(options = {}) {
  const shouldSync = options.sync !== false;
  migrateDailyStats();
  saveJson(storageKey("vocabulary"), vocabulary);
  saveJson(storageKey("progress"), progress);
  saveJson(storageKey("daily"), daily);
  saveJson(storageKey("snapshot"), {
    savedAt: new Date().toISOString(),
    vocabulary,
    progress,
    daily,
  });
  if (shouldSync) queueCloudSave();
}

function getStudyPayload(options = {}) {
  migrateDailyStats();
  const payload = {
    version: 2,
    savedAt: new Date().toISOString(),
    vocabulary,
    progress,
    daily,
  };
  if (options.resetAt) payload.resetAt = options.resetAt;
  return payload;
}

function hasStudyData() {
  return vocabulary.length > 0 || Object.keys(progress).length > 0 || Object.keys(daily).length > 0;
}

function getCloudConfig() {
  const config = window.KELIME_STUDIO_CLOUD || {};
  const firebaseConfig = config.firebaseConfig || DEFAULT_FIREBASE_CONFIG;
  // Always use the logged-in user's own path — ignore config.databasePath
  const databasePath = (USERS[AUTH.username]?.databasePath || `yds-vocabulary/${AUTH.username}`).replace(/^\/+|\/+$/g, "");
  const hasFirebase = typeof window.firebase !== "undefined" && firebaseConfig;
  const isConfigured = Boolean(
    hasFirebase &&
      firebaseConfig.apiKey &&
      firebaseConfig.databaseURL &&
      firebaseConfig.projectId
  );
  return { firebaseConfig, databasePath, isConfigured };
}

function initCloud() {
  const config = getCloudConfig();
  if (!config.isConfigured) return null;

  // Always re-create cloudRef so it points to the current user's path
  try {
    let app;
    try {
      app = firebase.app("yds-vocabulary-studio");
    } catch {
      app = firebase.initializeApp(config.firebaseConfig, "yds-vocabulary-studio");
    }
    cloudDb = firebase.database(app);
    cloudRef = cloudDb.ref(config.databasePath);
    cloudDb.ref(".info/connected").on("value", (snap) => {
      if (!snap.val()) updateSyncStatus("Cloud Sync: Baglanti yok");
    });
    return cloudDb;
  } catch {
    updateSyncStatus("Cloud Sync: Hata");
    return null;
  }
}

function updateSyncStatus(message) {
  const status = $("#syncStatus");
  if (!status) return;
  if (!message) {
    message = getCloudConfig().isConfigured ? "Cloud Sync: Acik" : "Cloud Sync: Kapali";
  }
  status.textContent = message;
  // Update mobile FAB sync label
  const badge = $("#syncStatusMobile");
  if (badge) badge.textContent = message;
}

function queueCloudSave() {
  if (!sessionStorage.getItem("yds-vocab-auth")) return;
  if (!getCloudConfig().isConfigured) {
    updateSyncStatus();
    return;
  }
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(() => {
    saveToCloud();
  }, 500);
}

async function syncFromFirebase() {
  const config = getCloudConfig();
  if (!config.isConfigured) {
    updateSyncStatus("Cloud Sync: Kapali");
    saveStudyData({ sync: false });
    return;
  }

  if (cloudSyncInProgress) return;
  cloudSyncInProgress = true;
  updateSyncStatus("Cloud Sync: Yukleniyor");

  try {
    const db = initCloud();
    if (!db || !cloudRef) throw new Error("Firebase is not available");
    const snap = await cloudRef.once("value");
    const remote = snap.val();
    const remotePayload = remote?.data || (remote?.vocabulary ? remote : null);
    const hadRemoteVocab = Array.isArray(remotePayload?.vocabulary) && remotePayload.vocabulary.length > 0;

    if (remotePayload?.resetAt) {
      // === RESET STATE: Firebase holds intentional reset — always apply, never merge ===
      vocabulary = hadRemoteVocab ? remotePayload.vocabulary : [];
      progress = {};
      daily = {};
      [storageKey("vocabulary"), storageKey("progress"), storageKey("daily"), storageKey("snapshot")].forEach((k) => localStorage.removeItem(k));
      vocabulary.forEach((item) => { progress[String(item.id)] = createProgress(String(item.id)); });
      if (remotePayload.progress && Object.keys(remotePayload.progress).length) {
        Object.assign(progress, remotePayload.progress);
      }
      saveStudyData({ sync: false });
      attachCloudListener();
      // resetAt stays in Firebase — cleared only on the next user-initiated save (studying/import)
      updateSyncStatus("Cloud Sync: Guncel");

    } else if (hadRemoteVocab) {
      // === NORMAL SYNC: Firebase is source of truth — replace local completely, never write back ===
      // This prevents any device from re-uploading stale local data and overwriting Firebase.
      vocabulary = remotePayload.vocabulary;
      progress = typeof remotePayload.progress === "object" && remotePayload.progress
        ? remotePayload.progress : {};
      daily = typeof remotePayload.daily === "object" && remotePayload.daily
        ? remotePayload.daily : {};
      saveStudyData({ sync: false });
      attachCloudListener();
      updateSyncStatus("Cloud Sync: Guncel");

    } else {
      // === EMPTY FIREBASE: upload local data if any ===
      saveStudyData({ sync: false });
      attachCloudListener();
      if (hasStudyData()) {
        await saveToFirebase();
      } else {
        updateSyncStatus("Cloud Sync: Guncel");
      }
    }
  } catch {
    updateSyncStatus("Cloud Sync: Hata");
  } finally {
    cloudSyncInProgress = false;
  }
}

function attachCloudListener() {
  if (cloudListenerAttached || !cloudRef) return;
  cloudListenerAttached = true;
  const listenerOwner = AUTH.username; // hangi kullanıcı için açıldı
  cloudRef.on("value", (snap) => {
    // Kullanıcı değişmişse bu listener'ı yok say
    if (AUTH.username !== listenerOwner) return;
    if (applyingRemoteData) return;
    const remote = snap.val();
    const remoteData = remote?.data || (remote?.vocabulary ? remote : null);
    const hadRemoteVocab = Array.isArray(remoteData?.vocabulary) && remoteData.vocabulary.length > 0;
    const isReset = Boolean(remoteData?.resetAt);

    if (!remoteData || (!hadRemoteVocab && !isReset)) return;

    if (isReset) {
      // Reset from another device — apply completely, never merge
      const localSnapshot = loadJson(storageKey("snapshot"), null);
      const resetIsNewer = !localSnapshot?.savedAt || remoteData.resetAt > localSnapshot.savedAt;
      if (!resetIsNewer) return; // already applied this reset
      lastResetAt = remoteData.resetAt;
      vocabulary = hadRemoteVocab ? remoteData.vocabulary : [];
      progress = {};
      daily = {};
      [storageKey("vocabulary"), storageKey("progress"), storageKey("daily"), storageKey("snapshot")].forEach((k) => localStorage.removeItem(k));
      vocabulary.forEach((item) => { progress[String(item.id)] = createProgress(String(item.id)); });
      if (remoteData.progress && Object.keys(remoteData.progress).length) {
        Object.assign(progress, remoteData.progress);
      }
      saveStudyData({ sync: false });
      renderAll();
      updateSyncStatus("Cloud Sync: Guncel");
    } else {
      // Normal update from another device — replace local completely, never merge
      applyingRemoteData = true;
      vocabulary = remoteData.vocabulary;
      progress = typeof remoteData.progress === "object" && remoteData.progress ? remoteData.progress : {};
      daily = typeof remoteData.daily === "object" && remoteData.daily ? remoteData.daily : {};
      saveStudyData({ sync: false });
      renderAll();
      applyingRemoteData = false;
      updateSyncStatus("Cloud Sync: Guncel");
    }
  }, () => {
    updateSyncStatus("Cloud Sync: Hata");
  });
}

async function saveToFirebase(options = {}) {
  const config = getCloudConfig();
  if (!config.isConfigured || !sessionStorage.getItem("yds-vocab-auth")) return;
  const db = initCloud();
  if (!db || !cloudRef) return;
  updateSyncStatus("Cloud Sync: Kaydediliyor");

  try {
    applyingRemoteData = true;
    await cloudRef.update({
      username: AUTH.username,
      data: getStudyPayload(options),
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
    });
    applyingRemoteData = false;
    updateSyncStatus("Cloud Sync: Guncel");
  } catch {
    applyingRemoteData = false;
    updateSyncStatus("Cloud Sync: Hata");
  }
}

function detachCloudListener() {
  if (!cloudRef) return;
  cloudRef.off("value");
  cloudListenerAttached = false;
}

async function syncFromCloud() {
  return syncFromFirebase();
}

async function saveToCloud(options = {}) {
  return saveToFirebase(options);
}

function restoreStudyDataIfNeeded() {
  const snapshot = loadJson(storageKey("snapshot"), null);
  if (snapshot) {
    if (!vocabulary.length && Array.isArray(snapshot.vocabulary)) vocabulary = snapshot.vocabulary;
    if (!Object.keys(progress).length && snapshot.progress && typeof snapshot.progress === "object") progress = snapshot.progress;
    if (!Object.keys(daily).length && snapshot.daily && typeof snapshot.daily === "object") daily = snapshot.daily;
  }

  migrateDailyStats();
  saveStudyData({ sync: false });
}

function importProgressBackup(jsonText, fileName) {
  try {
    const backup = JSON.parse(jsonText);
    if (!Array.isArray(backup.vocabulary) || typeof backup.progress !== "object" || typeof backup.daily !== "object") {
      setStatus("Yedek dosyasi uygun formatta degil.");
      return;
    }

    mergeBackupData(backup);
    saveStudyData();
    renderAll();
    setStatus(`${fileName} yedegi yuklendi. Toplam ${vocabulary.length} kelime hazir.`);
  } catch {
    setStatus("Yedek dosyasi okunamadi.");
  }
}

function mergeBackupData(backup) {
  // Safety guard: never merge an empty or invalid payload (unless it's an intentional reset)
  if (!backup) return;
  if (!Array.isArray(backup.vocabulary)) return;
  if (backup.vocabulary.length === 0 && !backup.resetAt) return;

  const existingById = new Map(vocabulary.map((item) => [item.id, item]));
  const existingWordToId = new Map(vocabulary.map((item) => [normalizeWordKey(item.word), item.id]));

  backup.vocabulary.forEach((item) => {
    if (!item?.word || !item?.englishMeaning) return;
    const cleanItem = {
      id: String(item.id || `word:${normalizeWordKey(item.word)}`),
      word: String(item.word).trim(),
      englishMeaning: String(item.englishMeaning).trim(),
    };
    const wordKey = normalizeWordKey(cleanItem.word);
    const existingId = existingById.has(cleanItem.id) ? cleanItem.id : existingWordToId.get(wordKey);
    const targetId = existingId || cleanItem.id;
    const nextItem = { ...(existingById.get(targetId) || {}), ...cleanItem, id: targetId };

    existingById.set(targetId, nextItem);
    existingWordToId.set(wordKey, targetId);
    if (backup.progress?.[cleanItem.id]) {
      progress[targetId] = mergeProgress(progress[targetId] || createProgress(targetId), backup.progress[cleanItem.id], targetId);
    }
    if (!progress[targetId]) progress[targetId] = createProgress(targetId);
  });

  Object.entries(backup.progress || {}).forEach(([wordId, itemProgress]) => {
    if (!existingById.has(wordId)) return;
    progress[wordId] = mergeProgress(progress[wordId] || createProgress(wordId), itemProgress, wordId);
  });

  Object.entries(backup.daily || {}).forEach(([date, item]) => {
    daily[date] = mergeDailyStats(daily[date], item, date);
  });

  vocabulary = dedupeVocabularyByWord(Array.from(existingById.values()));
  migrateDailyStats();
}

function todayKey(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return formatDateKey(date);
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyModeStats() {
  return {
    flashcards: { studiedCount: 0, correctCount: 0, wrongCount: 0 },
    quiz: { studiedCount: 0, correctCount: 0, wrongCount: 0 },
    matching: { studiedCount: 0, correctCount: 0, wrongCount: 0 },
  };
}

function migrateDailyStats() {
  Object.entries(daily).forEach(([date, item]) => {
    daily[date] = normalizeDailyStats(item, date);
  });
}

function normalizeDailyStats(item = {}, date = todayKey()) {
  const modes = emptyModeStats();
  Object.entries(item.modes || {}).forEach(([mode, stats]) => {
    if (!modes[mode]) return;
    modes[mode] = {
      studiedCount: Number(stats?.studiedCount || 0),
      correctCount: Number(stats?.correctCount || 0),
      wrongCount: Number(stats?.wrongCount || 0),
    };
  });

  return {
    date,
    studiedCount: Number(item.studiedCount || 0),
    correctCount: Number(item.correctCount || 0),
    wrongCount: Number(item.wrongCount || 0),
    modes,
  };
}

function mergeDailyStats(current, incoming, date) {
  const left = normalizeDailyStats(current, date);
  const right = normalizeDailyStats(incoming, date);
  const modes = emptyModeStats();

  Object.keys(modes).forEach((mode) => {
    modes[mode] = {
      studiedCount: Math.max(left.modes[mode].studiedCount, right.modes[mode].studiedCount),
      correctCount: Math.max(left.modes[mode].correctCount, right.modes[mode].correctCount),
      wrongCount: Math.max(left.modes[mode].wrongCount, right.modes[mode].wrongCount),
    };
  });

  return {
    date,
    studiedCount: Math.max(left.studiedCount, right.studiedCount),
    correctCount: Math.max(left.correctCount, right.correctCount),
    wrongCount: Math.max(left.wrongCount, right.wrongCount),
    modes,
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replaceAll("\u0131", "i")
    .replaceAll("\u00f6", "o")
    .replaceAll("\u00fc", "u")
    .replaceAll("\u015f", "s")
    .replaceAll("\u00e7", "c")
    .replaceAll("\u011f", "g")
    .replaceAll("\u0130", "i")
    .replace(/\s+/g, "");
}

function importVocabulary(csvText, message) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    setStatus("Kullanilabilir satir bulunamadi.");
    return;
  }

  const headers = rows[0].map(normalizeHeader);
  const findIndex = (...names) => headers.findIndex((header) => names.includes(header));
  const indexes = {
    id: findIndex("no", "id"),
    word: findIndex("sozcuk", "word", "kelime"),
    englishMeaning: findIndex("turkcekarsiligi", "turkishmeaning", "turkish", "anlam"),
  };

  if (indexes.word < 0 || indexes.englishMeaning < 0) {
    setStatus("Gerekli sutunlar eksik: No, Sozcuk ve Turkce Karsiligi.");
    return;
  }

  const importedVocabulary = rows.slice(1).map((row, index) => ({
    id: cleanCell(row[indexes.id]) || `word:${normalizeHeader(cleanCell(row[indexes.word])) || index + 1}`,
    word: cleanCell(row[indexes.word]),
    englishMeaning: cleanCell(row[indexes.englishMeaning]),
  })).filter((item) => item.word && item.englishMeaning);

  const existingById = new Map(vocabulary.map((item) => [item.id, item]));
  const existingWordToId = new Map(vocabulary.map((item) => [normalizeWordKey(item.word), item.id]));
  let addedCount = 0;
  let updatedCount = 0;

  importedVocabulary.forEach((item) => {
    const wordKey = normalizeWordKey(item.word);
    const existingId = existingById.has(item.id) ? item.id : existingWordToId.get(wordKey);

    if (existingId) {
      existingById.set(existingId, { ...existingById.get(existingId), ...item, id: existingId });
      updatedCount += 1;
    } else {
      existingById.set(item.id, item);
      existingWordToId.set(wordKey, item.id);
      addedCount += 1;
    }

    const progressId = existingId || item.id;
    if (!progress[progressId]) {
      progress[progressId] = createProgress(progressId);
    }
  });

  vocabulary = dedupeVocabularyByWord(Array.from(existingById.values()));

  saveStudyData();
  setStatus(`${message} ${addedCount} yeni, ${updatedCount} guncel, toplam ${vocabulary.length} kelime.`);
  renderAll();
}

function cleanCell(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWordKey(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR");
}

function dedupeVocabularyByWord(items) {
  const seen = new Map();

  items.forEach((item) => {
    const wordKey = normalizeWordKey(item.word);
    const existing = seen.get(wordKey);

    if (!existing) {
      seen.set(wordKey, item);
      return;
    }

    const existingProgress = progress[existing.id] || createProgress(existing.id);
    const duplicateProgress = progress[item.id] || createProgress(item.id);
    progress[existing.id] = mergeProgress(existingProgress, duplicateProgress, existing.id);
    delete progress[item.id];
    seen.set(wordKey, {
      ...existing,
      ...item,
      id: existing.id,
    });
  });

  return Array.from(seen.values());
}

function mergeProgress(first, second, wordId) {
  return {
    wordId,
    status: statusRank(second.status) > statusRank(first.status) ? second.status : first.status,
    correctCount: Math.max(first.correctCount || 0, second.correctCount || 0),
    wrongCount: Math.max(first.wrongCount || 0, second.wrongCount || 0),
    lastSeenAt: [first.lastSeenAt, second.lastSeenAt].filter(Boolean).sort().pop() || null,
    nextReviewAt: [first.nextReviewAt, second.nextReviewAt].filter(Boolean).sort()[0] || todayKey(),
  };
}

function statusRank(status) {
  return {
    new: 0,
    learning: 1,
    known: 2,
    difficult: 3,
  }[status] || 0;
}

function createProgress(wordId) {
  return {
    wordId,
    status: "new",
    correctCount: 0,
    wrongCount: 0,
    correctSinceDifficult: 0,   // zor listesinden çıkmak için gereken doğru sayacı
    lastSeenAt: null,
    nextReviewAt: todayKey(),
  };
}

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const isExcel = /\.(xlsx|xls)$/i.test(file.name);
  const isJsonBackup = /\.json$/i.test(file.name);

  if (isJsonBackup) {
    const text = await file.text();
    importProgressBackup(text, file.name);
    event.target.value = "";
    return;
  }

  if (isExcel) {
    if (!window.XLSX) {
      setStatus("Excel okumak icin internet baglantisi veya XLSX kutuphanesi gerekli.");
      return;
    }
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const csvText = XLSX.utils.sheet_to_csv(firstSheet);
    importVocabulary(csvText, `${file.name} ice aktarildi.`);
    event.target.value = "";
    return;
  }

  const text = await file.text();
  importVocabulary(text, `${file.name} ice aktarildi.`);
  event.target.value = "";
}

async function handleUrlLoad(event) {
  event.preventDefault();
  const url = $("#csvUrl").value.trim();
  if (!url) return;

  try {
    setStatus("CSV adresi yukleniyor...");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    importVocabulary(text, "Google Sheets CSV yuklendi.");
  } catch (error) {
    setStatus(`URL yuklenemedi: ${error.message}`);
  }
}

function switchView(viewName) {
  activeView = viewName;
  $$(".tab-button").forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewName));

  if (viewName === "flashcards") nextCard(false);
  if (viewName === "quiz") nextQuiz();
  if (viewName === "matching") newMatchSet();
  if (viewName === "analytics") renderAnalytics();
  if (viewName === "words") renderWords();
}

function getProgress(item) {
  if (!progress[item.id]) progress[item.id] = createProgress(item.id);
  return progress[item.id];
}

function isDue(item) {
  const itemProgress = getProgress(item);
  return !itemProgress.nextReviewAt || itemProgress.nextReviewAt <= todayKey();
}

function wordsForMode(mode) {
  if (mode === "difficult") return vocabulary.filter((item) => getProgress(item).status === "difficult");
  return vocabulary; // "all"
}

function nextCard(forceAdvance = true) {
  const pool = wordsForMode(cardMode);
  if (!pool.length) {
    currentCard = null;
    updateCard(null);
    return;
  }

  if (!forceAdvance && currentCard && pool.some((item) => item.id === currentCard.id)) {
    updateCard(currentCard);
    return;
  }

  // Mevcut kartı dışla
  const candidates = currentCard ? pool.filter((item) => item.id !== currentCard.id) : pool;

  // Yanlış cooldown listesini filtrele — havuz yeterliyse
  const withoutWrong = candidates.filter((item) => !wrongCooldownIds.includes(item.id));

  // Son görülen kartları filtrele — havuz yeterliyse
  const withoutRecent = withoutWrong.filter((item) => !recentCardIds.includes(item.id));

  // Kademeli gevşeme: havuz daralırsa kısıtlamaları azalt
  let source;
  if (withoutRecent.length >= 1) {
    source = withoutRecent;
  } else if (withoutWrong.length >= 1) {
    source = withoutWrong;
  } else if (candidates.length >= 1) {
    source = candidates;
  } else {
    source = pool;
  }

  // TAM RASTGELE — hiçbir ağırlıklandırma yok
  currentCard = source[Math.floor(Math.random() * source.length)];

  // Genel tamponu güncelle
  recentCardIds.push(currentCard.id);
  if (recentCardIds.length > RECENT_BUFFER_SIZE) recentCardIds.shift();

  updateCard(currentCard);
}

function updateCard(item) {
  const hasItem = Boolean(item);
  const card = $("#flashcard");
  card.classList.remove("swiping-left", "swiping-right");
  card.style.transform = "";
  $("#cardStatus").textContent = hasItem ? `${modeLabel(cardMode)} queue` : "Bu kuyrukta kelime yok.";
  $("#cardWord").textContent = hasItem ? item.word : "Bitti";
  $("#cardEnglish").textContent = hasItem ? item.englishMeaning : "";
  $("#cardEnglish").classList.add("hidden");
  $("#revealButton").disabled = !hasItem;
  $("#wrongButton").disabled = !hasItem;
  $("#rightButton").disabled = !hasItem;
}

function startCardPointer(event) {
  if (!currentCard || event.target.closest("button")) return;
  cardPointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    moved: false,
  };
  $("#flashcard").setPointerCapture?.(event.pointerId);
}

function moveCardPointer(event) {
  if (!cardPointer || cardPointer.id !== event.pointerId) return;
  const deltaX = event.clientX - cardPointer.x;
  const deltaY = event.clientY - cardPointer.y;
  const card = $("#flashcard");

  if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
    cardPointer.moved = true;
  }

  if (Math.abs(deltaX) > 10) {
    // Move diagonally: follow X, lift upward proportionally (max -80px up)
    const liftY = Math.abs(deltaX) > 30 ? Math.max(-80, -(Math.abs(deltaX) - 30) * 0.7) : 0;
    const rotate = Math.max(-12, Math.min(12, deltaX / 16));
    card.style.transform = `translateX(${deltaX}px) translateY(${liftY}px) rotate(${rotate}deg)`;
    card.classList.toggle("swiping-right", deltaX > 50);
    card.classList.toggle("swiping-left", deltaX < -50);
  }
}

function endCardPointer(event) {
  if (!cardPointer || cardPointer.id !== event.pointerId) return;
  const deltaX = event.clientX - cardPointer.x;
  const deltaY = event.clientY - cardPointer.y;
  // Accept swipe if X is dominant and enough distance (Y going up is allowed)
  const upwardBoost = deltaY < 0 ? Math.abs(deltaY) * 0.4 : 0;
  const shouldSwipe = (Math.abs(deltaX) + upwardBoost) > 90 && Math.abs(deltaX) > Math.abs(deltaY) * 0.7;

  if (shouldSwipe) {
    const goRight = deltaX > 0;
    const card = $("#flashcard");
    // Fly off diagonally: continue in swipe direction, lift upward
    card.style.transition = "transform 180ms ease";
    card.style.transform = `translateX(${goRight ? 260 : -260}px) translateY(-90px) rotate(${goRight ? 14 : -14}deg)`;
    window.setTimeout(() => {
      card.style.transition = "";
      answerCard(goRight);
    }, 170);
  } else if (!cardPointer.moved) {
    revealCard();
  } else {
    cancelCardPointer();
  }

  cardPointer = null;
}

function cancelCardPointer() {
  const card = $("#flashcard");
  card.classList.remove("swiping-left", "swiping-right");
  card.style.transform = "";
  cardPointer = null;
}

function revealCard() {
  if (!currentCard) return;
  if ($("#cardEnglish").textContent) $("#cardEnglish").classList.remove("hidden");
}

function answerCard(isCorrect) {
  if (!currentCard) return;

  // Yanlış cevaplanan kartı uzun bekleme listesine ekle
  if (!isCorrect) {
    wrongCooldownIds.push(currentCard.id);
    if (wrongCooldownIds.length > WRONG_COOLDOWN_SIZE) wrongCooldownIds.shift();
  }

  recordAnswer(currentCard.id, isCorrect, "flashcards");
  renderAll();
  nextCard();
}

function recordAnswer(wordId, isCorrect, mode = "flashcards") {
  const itemProgress = progress[wordId] || createProgress(wordId);
  itemProgress.lastSeenAt = new Date().toISOString();

  if (isCorrect) {
    itemProgress.correctCount += 1;

    if (itemProgress.status === "difficult") {
      // Zor listesindeki kelime: 3 doğru yapınca listeden çıkar
      itemProgress.correctSinceDifficult = (itemProgress.correctSinceDifficult || 0) + 1;
      if (itemProgress.correctSinceDifficult >= 3) {
        itemProgress.status = "learning";
        itemProgress.correctSinceDifficult = 0;
      }
    } else {
      itemProgress.status = "learning";
      itemProgress.correctSinceDifficult = 0;
    }
  } else {
    itemProgress.wrongCount += 1;
    itemProgress.status = "difficult";       // 1 yanlış = zor listesine ekle
    itemProgress.correctSinceDifficult = 0;  // doğru sayacını sıfırla
  }

  progress[wordId] = itemProgress;
  recordDaily(isCorrect, mode);
}

function nextReviewDate(correctCount) {
  const intervals = [1, 3, 7, 14, 30];
  const days = intervals[Math.min(correctCount - 1, intervals.length - 1)];
  return todayKey(days);
}

function recordDaily(isCorrect, mode = "flashcards") {
  const key = todayKey();
  daily[key] = normalizeDailyStats(daily[key] || { date: key }, key);
  daily[key].studiedCount += 1;
  if (isCorrect) daily[key].correctCount += 1;
  else daily[key].wrongCount += 1;

  const modeStats = daily[key].modes[mode] || { studiedCount: 0, correctCount: 0, wrongCount: 0 };
  modeStats.studiedCount += 1;
  if (isCorrect) modeStats.correctCount += 1;
  else modeStats.wrongCount += 1;
  daily[key].modes[mode] = modeStats;
  saveStudyData();
}

function nextQuiz() {
  window.clearTimeout(quizAdvanceTimer);
  $("#quizFeedback").textContent = "";
  if (vocabulary.length < 4) {
    $("#quizPrompt").textContent = "Quiz icin en az 4 kelime yukle.";
    $("#quizOptions").innerHTML = "";
    return;
  }

  const pool = wordsForMode(quizMode);
  if (pool.length < 4) {
    $("#quizPrompt").textContent = "Bu modda en az 4 kelime gerekli.";
    $("#quizOptions").innerHTML = "";
    return;
  }

  const answer = randomItem(pool);
  // Yanlış seçenekler tüm kelimelerden gelsin
  const distractors = shuffle(vocabulary.filter((item) => item.id !== answer.id)).slice(0, 3);
  const options = shuffle([answer, ...distractors]);

  currentQuiz = answer;
  $("#quizPrompt").textContent = `${answer.word} = ?`;
  $("#quizOptions").innerHTML = options.map((item) => (
    `<button type="button" data-id="${escapeHtml(item.id)}">${escapeHtml(item.englishMeaning)}</button>`
  )).join("");

  $$("#quizOptions button").forEach((button) => {
    button.addEventListener("click", () => answerQuiz(button));
  });
}

function answerQuiz(button) {
  if (!currentQuiz || button.disabled) return;
  const isCorrect = button.dataset.id === currentQuiz.id;
  recordAnswer(currentQuiz.id, isCorrect, "quiz");
  $$("#quizOptions button").forEach((option) => {
    option.disabled = true;
    option.classList.toggle("correct", option.dataset.id === currentQuiz.id);
  });
  if (!isCorrect) button.classList.add("wrong");
  $("#quizFeedback").textContent = isCorrect
    ? "Dogru."
    : `Cevap: ${currentQuiz.englishMeaning}`;
  renderDashboard();
  renderAnalytics();
  renderWords();
  quizAdvanceTimer = window.setTimeout(nextQuiz, 1000);
}

function newMatchSet() {
  selectedMatchWord = null;
  selectedMatchMeaning = null;
  draggedMatchId = null;
  currentMatchIds = new Set();
  $("#matchFeedback").textContent = "";

  if (vocabulary.length < 4) {
    $("#matchWords").innerHTML = "";
    $("#matchMeanings").innerHTML = "";
    $("#matchFeedback").textContent = "Eslestirme icin en az 4 kelime yukle.";
    return;
  }

  const pool = wordsForMode(matchMode);
  if (pool.length < 4) {
    $("#matchWords").innerHTML = "";
    $("#matchMeanings").innerHTML = "";
    $("#matchFeedback").textContent = "Bu modda en az 4 kelime gerekli.";
    return;
  }

  const selected = shuffle(pool).slice(0, 4);
  currentMatchIds = new Set(selected.map((item) => item.id));
  $("#matchWords").innerHTML = selected.map((item) => (
    `<button class="match-card draggable-card" type="button" draggable="true" data-id="${escapeHtml(item.id)}">${escapeHtml(item.word)}</button>`
  )).join("");
  $("#matchMeanings").innerHTML = shuffle(selected).map((item) => (
    `<button class="match-card drop-zone" type="button" data-id="${escapeHtml(item.id)}">${escapeHtml(item.englishMeaning)}</button>`
  )).join("");

  $$("#matchWords .match-card").forEach((button) => {
    button.addEventListener("click", () => selectMatch(button, "word"));
    button.addEventListener("dragstart", handleMatchDragStart);
    button.addEventListener("dragend", handleMatchDragEnd);
  });
  $$("#matchMeanings .match-card").forEach((button) => {
    button.addEventListener("click", () => selectMatch(button, "meaning"));
    button.addEventListener("dragover", handleMatchDragOver);
    button.addEventListener("dragleave", handleMatchDragLeave);
    button.addEventListener("drop", handleMatchDrop);
  });
}

function handleMatchDragStart(event) {
  draggedMatchId = event.currentTarget.dataset.id;
  event.currentTarget.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedMatchId);
}

function handleMatchDragEnd(event) {
  event.currentTarget.classList.remove("dragging");
  $$("#matchMeanings .match-card").forEach((item) => item.classList.remove("drag-over"));
  draggedMatchId = null;
}

function handleMatchDragOver(event) {
  event.preventDefault();
  if (!event.currentTarget.disabled) {
    event.currentTarget.classList.add("drag-over");
  }
}

function handleMatchDragLeave(event) {
  event.currentTarget.classList.remove("drag-over");
}

function handleMatchDrop(event) {
  event.preventDefault();
  const wordId = event.dataTransfer.getData("text/plain") || draggedMatchId;
  const meaningButton = event.currentTarget;
  meaningButton.classList.remove("drag-over");
  if (!wordId || meaningButton.disabled) return;
  resolveMatch(wordId, meaningButton);
}

function resolveMatch(wordId, meaningButton) {
  const wordButton = $(`#matchWords .match-card[data-id="${cssEscape(wordId)}"]`);
  if (!wordButton || wordButton.disabled) return;

  const isCorrect = wordId === meaningButton.dataset.id;
  recordAnswer(wordId, isCorrect, "matching");

  if (isCorrect) {
    wordButton.classList.add("correct");
    meaningButton.classList.add("correct");
    wordButton.disabled = true;
    meaningButton.disabled = true;
    currentMatchIds.delete(wordId);
    $("#matchFeedback").textContent = "Eslesti.";
    if (currentMatchIds.size === 0) {
      $("#matchFeedback").textContent = "Set tamamlandi. Yeni set geliyor...";
      window.setTimeout(newMatchSet, 900);
    }
  } else {
    wordButton.classList.add("wrong");
    meaningButton.classList.add("wrong");
    $("#matchFeedback").textContent = "Tekrar dene.";
    setTimeout(() => {
      wordButton.classList.remove("wrong");
      meaningButton.classList.remove("wrong");
    }, 500);
  }

  renderDashboard();
  renderAnalytics();
  renderWords();
}

function selectMatch(button, type) {
  if (button.classList.contains("correct")) return;

  if (type === "word") {
    selectedMatchWord = button;
    $$("#matchWords .match-card").forEach((item) => item.classList.toggle("selected", item === button));
  } else {
    selectedMatchMeaning = button;
    $$("#matchMeanings .match-card").forEach((item) => item.classList.toggle("selected", item === button));
  }

  if (selectedMatchWord && selectedMatchMeaning) {
    const wordButton = selectedMatchWord;
    const meaningButton = selectedMatchMeaning;
    const isCorrect = wordButton.dataset.id === meaningButton.dataset.id;
    recordAnswer(wordButton.dataset.id, isCorrect, "matching");

    if (isCorrect) {
      wordButton.classList.add("correct");
      meaningButton.classList.add("correct");
      wordButton.disabled = true;
      meaningButton.disabled = true;
      currentMatchIds.delete(wordButton.dataset.id);
      $("#matchFeedback").textContent = "Eslesti.";
      if (currentMatchIds.size === 0) {
        $("#matchFeedback").textContent = "Set tamamlandi. Yeni set geliyor...";
        window.setTimeout(newMatchSet, 900);
      }
    } else {
      wordButton.classList.add("wrong");
      meaningButton.classList.add("wrong");
      $("#matchFeedback").textContent = "Tekrar dene.";
      setTimeout(() => {
        wordButton.classList.remove("wrong");
        meaningButton.classList.remove("wrong");
      }, 500);
    }

    selectedMatchWord.classList.remove("selected");
    selectedMatchMeaning.classList.remove("selected");
    selectedMatchWord = null;
    selectedMatchMeaning = null;
    renderDashboard();
    renderAnalytics();
    renderWords();
  }
}

function renderAll() {
  renderDashboard();
  renderAnalytics();
  renderWords();
  if (activeView === "flashcards") nextCard(false);
}

function renderDashboard() {
  const known = vocabulary.filter((item) => getProgress(item).status === "known").length;
  const difficult = vocabulary.filter((item) => getProgress(item).status === "difficult").length;
  const due = vocabulary.filter(isDue).length;
  const today = normalizeDailyStats(daily[todayKey()] || { date: todayKey() }, todayKey());

  $("#dueCount").textContent = due;
  $("#knownCount").textContent = known;
  $("#difficultCount").textContent = difficult;
  $("#studiedToday").textContent = today.studiedCount;

  const dueItems = vocabulary.filter(isDue).slice(0, 6);
  $("#todayList").innerHTML = dueItems.length
    ? dueItems.map((item) => compactItemTemplate(item)).join("")
    : `<div class="compact-item"><strong>Bugun tekrar yok</strong><span class="muted">Kelime yukle veya yeni kart calis.</span></div>`;

  renderWeeklyBars();
}

function renderWeeklyBars() {
  const days = Array.from({ length: 7 }, (_, index) => todayKey(index - 6));
  const max = Math.max(1, ...days.map((day) => normalizeDailyStats(daily[day], day).studiedCount || 0));
  $("#weeklyBars").innerHTML = days.map((day) => {
    const count = normalizeDailyStats(daily[day], day).studiedCount || 0;
    const label = day.slice(5);
    return `
      <div class="bar-row">
        <span>${label}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(count / max) * 100}%"></div></div>
        <span>${count}</span>
      </div>
    `;
  }).join("");
}

function renderAnalytics() {
  if (!$("#analyticsContainer")) return;

  const days = Array.from({ length: 15 }, (_, i) => todayKey(i - 14));
  const modes = ["flashcards", "quiz", "matching"];
  const modeLabels = { flashcards: "Kartlar", quiz: "Quiz", matching: "Eşleştir" };
  const modeColors = { flashcards: "var(--teal)", quiz: "var(--blue)", matching: "var(--yellow)" };

  // Per-mode günlük veri
  const modeData = {};
  modes.forEach((mode) => {
    modeData[mode] = days.map((day) => {
      const s = normalizeDailyStats(daily[day], day).modes[mode];
      return { day, studied: s.studiedCount, correct: s.correctCount, wrong: s.wrongCount };
    });
  });

  // Maksimum değer (bar ölçeği için)
  const allStudied = days.map((day) => {
    const s = normalizeDailyStats(daily[day], day);
    return s.studiedCount;
  });
  const maxVal = Math.max(1, ...allStudied);

  // HTML oluştur
  let html = `<div class="analytics-15-grid">`;

  modes.forEach((mode) => {
    const totals = modeData[mode].reduce((a, d) => ({
      studied: a.studied + d.studied,
      correct: a.correct + d.correct,
      wrong: a.wrong + d.wrong,
    }), { studied: 0, correct: 0, wrong: 0 });
    const acc = totals.studied ? Math.round((totals.correct / totals.studied) * 100) : 0;

    html += `
      <section class="panel analytics-mode-panel">
        <div class="panel-heading">
          <div>
            <span class="section-kicker" style="color:${modeColors[mode]}">${modeLabels[mode]}</span>
            <h2>${acc}% doğru · ${totals.studied} soru</h2>
          </div>
        </div>
        <div class="analytics-day-bars">`;

    const modeMax = Math.max(1, ...modeData[mode].map((d) => d.studied));
    modeData[mode].forEach((d) => {
      const w = modeMax > 0 ? Math.max(2, (d.studied / modeMax) * 100) : 2;
      const dayAcc = d.studied ? Math.round((d.correct / d.studied) * 100) : null;
      const label = d.day.slice(5); // MM-DD
      html += `
        <div class="analytics-day-row">
          <span class="analytics-day-label">${label}</span>
          <div class="analytics-day-track">
            <div class="analytics-day-fill" style="width:${d.studied ? w : 0}%;background:${modeColors[mode]}"></div>
          </div>
          <span class="analytics-day-stat">${d.studied ? `${d.studied} · %${dayAcc}` : "—"}</span>
        </div>`;
    });

    html += `</div></section>`;
  });

  html += `</div>`;
  $("#analyticsContainer").innerHTML = html;
}

function periodStats(daysBack) {
  const days = Array.from({ length: daysBack + 1 }, (_, index) => todayKey(index - daysBack));
  return days.reduce((total, day) => {
    const item = normalizeDailyStats(daily[day], day);
    total.studiedCount += item.studiedCount || 0;
    total.correctCount += item.correctCount || 0;
    total.wrongCount += item.wrongCount || 0;
    return total;
  }, { studiedCount: 0, correctCount: 0, wrongCount: 0 });
}

function accuracy(stats) {
  const answered = (stats.correctCount || 0) + (stats.wrongCount || 0);
  return answered ? Math.round((stats.correctCount / answered) * 100) : 0;
}

function renderDailyAnalysisBars() {
  const days = Array.from({ length: 7 }, (_, index) => todayKey(index - 6));
  const max = Math.max(1, ...days.map((day) => normalizeDailyStats(daily[day], day).studiedCount || 0));
  $("#dailyAnalysisBars").innerHTML = days.map((day) => {
    const item = normalizeDailyStats(daily[day], day);
    const width = Math.max(4, (item.studiedCount / max) * 100);
    return analysisRowTemplate(day.slice(5), item, width);
  }).join("");
}

function renderMonthlyAnalysisBars() {
  const months = lastMonths(6);
  const monthStats = months.map((month) => ({
    label: month,
    ...statsForMonth(month),
  }));
  const max = Math.max(1, ...monthStats.map((item) => item.studiedCount));
  $("#monthlyAnalysisBars").innerHTML = monthStats.map((item) => (
    analysisRowTemplate(item.label, item, Math.max(4, (item.studiedCount / max) * 100))
  )).join("");
}

function analysisRowTemplate(label, stats, width) {
  return `
    <div class="analysis-row">
      <div>
        <strong>${escapeHtml(label)}</strong>
        <span>${stats.studiedCount || 0} kart / ${accuracy(stats)}% dogru</span>
      </div>
      <div class="analysis-track">
        <div class="analysis-fill" style="width:${width}%"></div>
      </div>
    </div>
  `;
}

function lastMonths(count) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

function statsForMonth(monthKey) {
  return Object.entries(daily)
    .filter(([date]) => date.startsWith(monthKey))
    .reduce((total, [, item]) => {
      const stats = normalizeDailyStats(item);
      total.studiedCount += stats.studiedCount || 0;
      total.correctCount += stats.correctCount || 0;
      total.wrongCount += stats.wrongCount || 0;
      return total;
    }, { studiedCount: 0, correctCount: 0, wrongCount: 0 });
}

function modeStats(daysBack) {
  const days = Array.from({ length: daysBack + 1 }, (_, index) => todayKey(index - daysBack));
  return days.reduce((total, day) => {
    const item = normalizeDailyStats(daily[day], day);
    Object.keys(total).forEach((mode) => {
      total[mode].studiedCount += item.modes[mode].studiedCount;
      total[mode].correctCount += item.modes[mode].correctCount;
      total[mode].wrongCount += item.modes[mode].wrongCount;
    });
    return total;
  }, emptyModeStats());
}

function renderLearningSummary(allTotals, monthTotals, modeTotals) {
  const counts = vocabulary.reduce((total, item) => {
    const status = getProgress(item).status;
    total[status] = (total[status] || 0) + 1;
    return total;
  }, { new: 0, learning: 0, known: 0, difficult: 0 });
  const due = vocabulary.filter(isDue).length;

  $("#learningSummary").innerHTML = [
    ["Toplam kelime", vocabulary.length],
    ["Bugun tekrar", due],
    ["Yeni", counts.new || 0],
    ["Ogreniliyor", counts.learning || 0],
    ["Bilinen", counts.known || 0],
    ["Zor", counts.difficult || 0],
    ["Toplam calisma", allTotals.studiedCount],
    ["Genel dogruluk", `${accuracy(allTotals)}%`],
    ["Aylik calisma", monthTotals.studiedCount],
    ["Kart yanit", modeTotals.flashcards.studiedCount],
    ["Quiz yanit", modeTotals.quiz.studiedCount],
    ["Eslesme yanit", modeTotals.matching.studiedCount],
  ].map(([label, value]) => `
    <div class="summary-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function renderWords() {
  const query = $("#searchInput")?.value.trim().toLocaleLowerCase("tr-TR") || "";
  const status = $("#statusFilter")?.value || "all";
  const filtered = vocabulary.filter((item) => {
    const itemProgress = getProgress(item);
    const matchesStatus = status === "all" || itemProgress.status === status;
    const searchable = `${item.word} ${item.englishMeaning}`.toLocaleLowerCase("tr-TR");
    return matchesStatus && searchable.includes(query);
  });

  $("#wordList").innerHTML = filtered.length
    ? filtered.map(wordItemTemplate).join("")
    : `<div class="word-item"><strong>Kelime bulunamadi</strong><span class="muted">Aramayi degistir veya liste yukle.</span></div>`;
}

function compactItemTemplate(item) {
  const itemProgress = getProgress(item);
  return `
    <div class="compact-item">
      <strong>${escapeHtml(item.word)}</strong>
      <span class="muted">${escapeHtml(item.englishMeaning)}</span>
      <div class="word-meta">
        <span class="pill">${escapeHtml(statusLabel(itemProgress.status))}</span>
        <span>${itemProgress.nextReviewAt || "bugun"}</span>
      </div>
    </div>
  `;
}

function wordItemTemplate(item) {
  const itemProgress = getProgress(item);
  return `
    <article class="word-item">
      <strong>${escapeHtml(item.word)}</strong>
      <div class="muted">${escapeHtml(item.englishMeaning)}</div>
      <div class="word-meta">
        <span class="pill">${escapeHtml(statusLabel(itemProgress.status))}</span>
        <span>Correct: ${itemProgress.correctCount}</span>
        <span>Wrong: ${itemProgress.wrongCount}</span>
        <span>Next: ${itemProgress.nextReviewAt || "bugun"}</span>
      </div>
    </article>
  `;
}

function modeLabel(mode) {
  return { all: "Tüm Kelimeler", difficult: "Yanlış Yapılanlar" }[mode] || mode;
}

function statusLabel(status) {
  return {
    new: "New",
    learning: "Learning",
    known: "Known",
    difficult: "Difficult",
  }[status] || status;
}

function setStatus(message) {
  $("#importStatus").textContent = message;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

// ── Reset Modal ──────────────────────────────────────────
function openResetModal() {
  $("#resetModal").classList.remove("hidden");
}

function closeResetModal() {
  $("#resetModal").classList.add("hidden");
}

function handleResetProgressOnly() {
  closeResetModal();
  const password = window.prompt("İlerleme verilerini silmek için şifreyi girin:");
  if (password === null) return;
  if (password !== AUTH.password) {
    window.alert("Şifre hatalı. Veriler silinmedi.");
    return;
  }

  downloadProgressBackup("before-progress-reset");
  progress = {};
  daily = {};
  [storageKey("progress"), storageKey("daily"), storageKey("snapshot")].forEach((key) => localStorage.removeItem(key));
  vocabulary.forEach((item) => {
    progress[String(item.id)] = createProgress(String(item.id));
  });
  detachCloudListener();
  saveStudyData({ sync: false });
  updateSyncStatus("Cloud Sync: Kaydediliyor");
  const resetAt = new Date().toISOString();
  saveToCloud({ resetAt })
    .then(() => window.location.reload())
    .catch(() => {
      updateSyncStatus("Cloud Sync: Hata");
      window.setTimeout(() => window.location.reload(), 1500);
    });
}

function handleResetEverything() {
  closeResetModal();
  const password = window.prompt("Tüm kelime ve ilerleme verilerini silmek için şifreyi girin:");
  if (password === null) return;
  if (password !== AUTH.password) {
    window.alert("Şifre hatalı. Veriler silinmedi.");
    return;
  }

  downloadProgressBackup("before-full-reset");
  vocabulary = [];
  progress = {};
  daily = {};
  [
    storageKey("vocabulary"),
    storageKey("progress"),
    storageKey("daily"),
    storageKey("snapshot"),
  ].forEach((key) => localStorage.removeItem(key));
  detachCloudListener();
  saveStudyData({ sync: false });
  updateSyncStatus("Cloud Sync: Kaydediliyor");
  const resetAt = new Date().toISOString();
  saveToCloud({ resetAt })
    .then(() => window.location.reload())
    .catch(() => {
      updateSyncStatus("Cloud Sync: Hata");
      window.setTimeout(() => window.location.reload(), 1500);
    });
}

// ── Focus Mode (Difficult words sprint) ──────────────────
let focusQueue = [];
let focusIndex = 0;
let focusRevealed = false;
let focusSessionCorrect = 0;
let focusSessionTotal = 0;

function openFocusMode() {
  const difficult = vocabulary.filter((item) => getProgress(item).status === "difficult");
  if (difficult.length === 0) {
    window.alert("Henüz 'Zor' olarak işaretlenmiş kelime yok.");
    return;
  }
  focusQueue = shuffle(difficult);
  focusIndex = 0;
  focusSessionCorrect = 0;
  focusSessionTotal = 0;
  $("#focusModal").classList.remove("hidden");
  renderFocusCard();
}

function closeFocusMode() {
  $("#focusModal").classList.add("hidden");
  if (focusSessionTotal > 0) {
    renderAll();
  }
}

function renderFocusCard() {
  if (focusIndex >= focusQueue.length) {
    // Session complete
    const pct = focusSessionTotal ? Math.round((focusSessionCorrect / focusSessionTotal) * 100) : 0;
    $("#focusWord").textContent = "Bitti! 🎉";
    $("#focusMeaning").textContent = `${focusSessionTotal} kelimeden ${focusSessionCorrect} tanesi doğru — %${pct}`;
    $("#focusMeaning").classList.remove("hidden");
    $("#focusCounter").textContent = "";
    $("#focusReveal").classList.add("hidden");
    $("#focusWrong").classList.add("hidden");
    $("#focusRight").classList.add("hidden");
    return;
  }

  const item = focusQueue[focusIndex];
  focusRevealed = false;
  $("#focusWord").textContent = item.word;
  $("#focusMeaning").textContent = item.englishMeaning;
  $("#focusMeaning").classList.add("hidden");
  $("#focusCounter").textContent = `${focusIndex + 1} / ${focusQueue.length}`;
  $("#focusReveal").classList.remove("hidden");
  $("#focusWrong").classList.remove("hidden");
  $("#focusRight").classList.remove("hidden");
}

function focusReveal() {
  if (focusIndex >= focusQueue.length) return;
  focusRevealed = true;
  $("#focusMeaning").classList.remove("hidden");
}

function focusAnswer(correct) {
  if (focusIndex >= focusQueue.length) return;
  const item = focusQueue[focusIndex];
  focusSessionTotal++;
  if (correct) {
    focusSessionCorrect++;
    // Promote out of difficult back to learning
    const p = getProgress(item);
    p.status = "learning";
    p.correctCount = (p.correctCount || 0) + 1;
    progress[item.id] = p;
  } else {
    const p = getProgress(item);
    p.wrongCount = (p.wrongCount || 0) + 1;
    progress[item.id] = p;
  }
  focusIndex++;
  saveStudyData();
  renderFocusCard();
}

// ── Mobile menu ──────────────────────────────────────────
function toggleMobileMenu() {
  const menu = $("#mobileMenu");
  const btn = $("#hamburgerButton");
  const isOpen = !menu.classList.contains("hidden");
  if (isOpen) {
    closeMobileMenu();
  } else {
    menu.classList.remove("hidden");
    btn.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
  }
}

function closeMobileMenu() {
  $("#mobileMenu")?.classList.add("hidden");
  const btn = $("#hamburgerButton");
  btn?.classList.remove("open");
  btn?.setAttribute("aria-expanded", "false");
}

function closeMobileMenuOnOutsideClick(event) {
  const menu = $("#mobileMenu");
  const btn = $("#hamburgerButton");
  if (!menu || menu.classList.contains("hidden")) return;
  if (!menu.contains(event.target) && !btn.contains(event.target)) {
    closeMobileMenu();
  }
}

function exportProgress() {
  downloadProgressBackup("manual-backup");
}

function downloadProgressBackup(prefix) {
  const payload = {
    exportedAt: new Date().toISOString(),
    vocabulary,
    progress,
    daily,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `yds-${prefix}-${todayKey()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
