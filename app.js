const STORAGE_KEYS = {
  vocabulary: "yds-vocab-items",
  progress: "yds-vocab-progress",
  daily: "yds-vocab-daily",
  snapshot: "yds-vocab-study-snapshot",
  auth: "yds-vocab-auth",
  theme: "yds-vocab-theme",
};

const AUTH = {
  username: "saldanli",
  password: "21542154",
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

let vocabulary = loadJson(STORAGE_KEYS.vocabulary, []);
let progress = loadJson(STORAGE_KEYS.progress, {});
let daily = loadJson(STORAGE_KEYS.daily, {});
let activeView = "dashboard";
let cardMode = "due";
let currentCard = null;
let currentQuiz = null;
let selectedMatchWord = null;
let selectedMatchMeaning = null;
let quizAdvanceTimer = null;
let draggedMatchId = null;
let currentMatchIds = new Set();
let cardPointer = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  restoreStudyDataIfNeeded();
  applyTheme();
  applyAuthState();
  renderAll();
});

function bindEvents() {
  $("#loginForm").addEventListener("submit", handleLogin);
  $("#themeButton").addEventListener("click", toggleTheme);
  $("#logoutButton").addEventListener("click", logout);
  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $$(".mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      cardMode = button.dataset.cardMode;
      $$(".mode-button").forEach((item) => item.classList.toggle("active", item === button));
      nextCard();
    });
  });

  $("#fileInput").addEventListener("change", handleFileUpload);
  $("#urlForm").addEventListener("submit", handleUrlLoad);
  $("#sampleButton").addEventListener("click", () => importVocabulary(sampleCsv, "\u00d6rnek kelime listesi y\u00fcklendi."));
  $("#resetButton").addEventListener("click", resetAll);
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
  $("#wrongButton").addEventListener("click", () => answerCard(false));
  $("#rightButton").addEventListener("click", () => answerCard(true));
  $("#nextQuizButton").addEventListener("click", nextQuiz);
  $("#newMatchButton").addEventListener("click", newMatchSet);
  $("#searchInput").addEventListener("input", renderWords);
  $("#statusFilter").addEventListener("change", renderWords);
  document.addEventListener("keydown", handleKeyboardShortcuts);
}

function handleLogin(event) {
  event.preventDefault();
  const username = $("#usernameInput").value.trim();
  const password = $("#passwordInput").value;

  if (username === AUTH.username && password === AUTH.password) {
    localStorage.setItem(STORAGE_KEYS.auth, "true");
    $("#loginMessage").textContent = "";
    applyAuthState();
    return;
  }

  $("#loginMessage").textContent = "Kullanici adi veya sifre hatali.";
}

function logout() {
  downloadProgressBackup("logout-backup");
  localStorage.removeItem(STORAGE_KEYS.auth);
  applyAuthState();
}

function applyAuthState() {
  const isLoggedIn = localStorage.getItem(STORAGE_KEYS.auth) === "true";
  $("#loginScreen").classList.toggle("hidden", isLoggedIn);
  document.body.classList.toggle("is-locked", !isLoggedIn);
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(STORAGE_KEYS.theme, nextTheme);
  applyTheme();
}

function applyTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const theme = savedTheme || (prefersDark ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  document.querySelector("meta[name='theme-color']")?.setAttribute("content", theme === "dark" ? "#0f1414" : "#151515");
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
  card.style.transform = `translateX(${isRight ? 140 : -140}px) rotate(${isRight ? 6 : -6}deg)`;
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

function saveStudyData() {
  saveJson(STORAGE_KEYS.vocabulary, vocabulary);
  saveJson(STORAGE_KEYS.progress, progress);
  saveJson(STORAGE_KEYS.daily, daily);
  saveJson(STORAGE_KEYS.snapshot, {
    savedAt: new Date().toISOString(),
    vocabulary,
    progress,
    daily,
  });
}

function restoreStudyDataIfNeeded() {
  const hasStudyData = vocabulary.length > 0 || Object.keys(progress).length > 0 || Object.keys(daily).length > 0;
  if (hasStudyData) {
    saveStudyData();
    return;
  }

  const snapshot = loadJson(STORAGE_KEYS.snapshot, null);
  if (!snapshot) return;

  vocabulary = Array.isArray(snapshot.vocabulary) ? snapshot.vocabulary : [];
  progress = snapshot.progress && typeof snapshot.progress === "object" ? snapshot.progress : {};
  daily = snapshot.daily && typeof snapshot.daily === "object" ? snapshot.daily : {};
  saveStudyData();
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
    lastSeenAt: null,
    nextReviewAt: todayKey(),
  };
}

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const isExcel = /\.(xlsx|xls)$/i.test(file.name);

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
    return;
  }

  const text = await file.text();
  importVocabulary(text, `${file.name} ice aktarildi.`);
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
  if (mode === "all") return vocabulary;
  if (mode === "new") return vocabulary.filter((item) => getProgress(item).status === "new");
  if (mode === "difficult") return vocabulary.filter((item) => getProgress(item).status === "difficult");
  return vocabulary.filter(isDue);
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

  const sorted = [...pool].sort((a, b) => {
    const pa = getProgress(a);
    const pb = getProgress(b);
    return (pa.lastSeenAt || "").localeCompare(pb.lastSeenAt || "") || pa.correctCount - pb.correctCount;
  });
  currentCard = sorted[0];
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
    const rotate = Math.max(-7, Math.min(7, deltaX / 20));
    card.style.transform = `translateX(${deltaX}px) rotate(${rotate}deg)`;
    card.classList.toggle("swiping-right", deltaX > 50);
    card.classList.toggle("swiping-left", deltaX < -50);
  }
}

function endCardPointer(event) {
  if (!cardPointer || cardPointer.id !== event.pointerId) return;
  const deltaX = event.clientX - cardPointer.x;
  const deltaY = event.clientY - cardPointer.y;
  const shouldSwipe = Math.abs(deltaX) > 90 && Math.abs(deltaX) > Math.abs(deltaY) * 1.1;

  if (shouldSwipe) {
    answerCard(deltaX > 0);
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
  recordAnswer(currentCard.id, isCorrect);
  renderAll();
  nextCard();
}

function recordAnswer(wordId, isCorrect) {
  const itemProgress = progress[wordId] || createProgress(wordId);
  itemProgress.lastSeenAt = new Date().toISOString();

  if (isCorrect) {
    itemProgress.correctCount += 1;
    itemProgress.status = itemProgress.correctCount >= 3 ? "known" : "learning";
    itemProgress.nextReviewAt = nextReviewDate(itemProgress.correctCount);
  } else {
    itemProgress.wrongCount += 1;
    itemProgress.status = "difficult";
    itemProgress.nextReviewAt = todayKey();
  }

  progress[wordId] = itemProgress;
  recordDaily(isCorrect);
}

function nextReviewDate(correctCount) {
  const intervals = [1, 3, 7, 14, 30];
  const days = intervals[Math.min(correctCount - 1, intervals.length - 1)];
  return todayKey(days);
}

function recordDaily(isCorrect) {
  const key = todayKey();
  daily[key] = daily[key] || { date: key, studiedCount: 0, correctCount: 0, wrongCount: 0 };
  daily[key].studiedCount += 1;
  if (isCorrect) daily[key].correctCount += 1;
  else daily[key].wrongCount += 1;
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

  const duePool = wordsForMode("due");
  const answer = randomItem(duePool.length ? duePool : vocabulary);
  const options = shuffle([
    answer,
    ...shuffle(vocabulary.filter((item) => item.id !== answer.id)).slice(0, 3),
  ]);

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
  recordAnswer(currentQuiz.id, isCorrect);
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

  const pool = shuffle(wordsForMode("due").length ? wordsForMode("due") : vocabulary).slice(0, 4);
  currentMatchIds = new Set(pool.map((item) => item.id));
  $("#matchWords").innerHTML = pool.map((item) => (
    `<button class="match-card draggable-card" type="button" draggable="true" data-id="${escapeHtml(item.id)}">${escapeHtml(item.word)}</button>`
  )).join("");
  $("#matchMeanings").innerHTML = shuffle(pool).map((item) => (
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
  recordAnswer(wordId, isCorrect);

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
    recordAnswer(wordButton.dataset.id, isCorrect);

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
  const today = daily[todayKey()] || { studiedCount: 0 };

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
  const max = Math.max(1, ...days.map((day) => daily[day]?.studiedCount || 0));
  $("#weeklyBars").innerHTML = days.map((day) => {
    const count = daily[day]?.studiedCount || 0;
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
  if (!$("#dailyAccuracy")) return;

  const today = periodStats(0);
  const week = periodStats(6);
  const month = periodStats(29);
  const allTotals = Object.values(daily).reduce((total, item) => ({
    studiedCount: total.studiedCount + (item.studiedCount || 0),
    correctCount: total.correctCount + (item.correctCount || 0),
    wrongCount: total.wrongCount + (item.wrongCount || 0),
  }), { studiedCount: 0, correctCount: 0, wrongCount: 0 });

  $("#dailyAccuracy").textContent = `${accuracy(today)}%`;
  $("#weeklyAccuracy").textContent = `${accuracy(week)}%`;
  $("#monthlyAccuracy").textContent = `${accuracy(month)}%`;
  $("#totalWrong").textContent = allTotals.wrongCount;

  renderDailyAnalysisBars();
  renderMonthlyAnalysisBars();
  renderLearningSummary(allTotals);
}

function periodStats(daysBack) {
  const days = Array.from({ length: daysBack + 1 }, (_, index) => todayKey(index - daysBack));
  return days.reduce((total, day) => {
    const item = daily[day] || {};
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
  const max = Math.max(1, ...days.map((day) => daily[day]?.studiedCount || 0));
  $("#dailyAnalysisBars").innerHTML = days.map((day) => {
    const item = daily[day] || { studiedCount: 0, correctCount: 0, wrongCount: 0 };
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
      total.studiedCount += item.studiedCount || 0;
      total.correctCount += item.correctCount || 0;
      total.wrongCount += item.wrongCount || 0;
      return total;
    }, { studiedCount: 0, correctCount: 0, wrongCount: 0 });
}

function renderLearningSummary(allTotals) {
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
  return {
    due: "Due",
    new: "New",
    difficult: "Difficult",
    all: "All",
  }[mode] || mode;
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

function resetAll() {
  const password = window.prompt("Tum kelime ve ilerleme verilerini silmek icin sifreyi girin:");
  if (password === null) return;
  if (password !== AUTH.password) {
    window.alert("Sifre hatali. Veriler silinmedi.");
    return;
  }

  downloadProgressBackup("before-reset");
  vocabulary = [];
  progress = {};
  daily = {};
  [
    STORAGE_KEYS.vocabulary,
    STORAGE_KEYS.progress,
    STORAGE_KEYS.daily,
    STORAGE_KEYS.snapshot,
  ].forEach((key) => localStorage.removeItem(key));
  renderAll();
  updateCard(null);
  $("#quizOptions").innerHTML = "";
  $("#matchWords").innerHTML = "";
  $("#matchMeanings").innerHTML = "";
  setStatus("Kelime listesi bekleniyor.");
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
