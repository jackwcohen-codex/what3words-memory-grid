const playableAreas = [
  { name: "Trafalgar Square", lat: 51.508, lng: -0.1281 },
  { name: "Eiffel Tower", lat: 48.8584, lng: 2.2945 },
  { name: "Taj Mahal", lat: 27.1751, lng: 78.0421 },
  { name: "Empire State Building", lat: 40.7484, lng: -73.9857 },
  { name: "Sydney Opera House", lat: -33.8568, lng: 151.2153 },
  { name: "Colosseum", lat: 41.8902, lng: 12.4922 },
  { name: "Statue of Liberty", lat: 40.6892, lng: -74.0445 },
  { name: "Sagrada Familia", lat: 41.4036, lng: 2.1744 },
  { name: "Burj Khalifa", lat: 25.1972, lng: 55.2744 },
  { name: "Tower Bridge", lat: 51.5055, lng: -0.0754 },
  { name: "Christ the Redeemer", lat: -22.9519, lng: -43.2105 },
  { name: "Golden Gate Bridge", lat: 37.8199, lng: -122.4783 },
  { name: "Louvre Pyramid", lat: 48.8606, lng: 2.3376 },
  { name: "Times Square", lat: 40.758, lng: -73.9855 },
  { name: "Piazza del Campo", lat: 43.3183, lng: 11.3318 },
];

const difficulties = {
  beginner: { label: "Beginner", scoreMultiplier: 1, zoom: 23 },
  easy: { label: "Easy", scoreMultiplier: 2, zoom: 22 },
  medium: { label: "Medium", scoreMultiplier: 5, zoom: 21 },
  hard: { label: "Hard", scoreMultiplier: 10, zoom: 20 },
  lethal: { label: "Lethal", scoreMultiplier: 20, zoom: 19 },
};

const studyPaces = {
  relaxed: { label: "Relaxed", flashMs: 3000, scoreMultiplier: 1 },
  normal: { label: "Normal", flashMs: 2200, scoreMultiplier: 3 },
  quick: { label: "Quick", flashMs: 1500, scoreMultiplier: 5 },
};

const playableBoundsPadding = {
  top: 0.18,
  right: 0.42,
  bottom: 0.18,
  left: 0.16,
};

const map = L.map("map", {
  zoomControl: false,
  minZoom: 18,
  maxZoom: 23,
});

L.control.zoom({ position: "bottomleft" }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 23,
  maxNativeZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const layers = {
  grid: L.layerGroup().addTo(map),
  study: L.layerGroup().addTo(map),
  result: L.layerGroup().addTo(map),
};

const els = {
  round: document.querySelector("#round"),
  totalScore: document.querySelector("#total-score"),
  phase: document.querySelector("#phase-label"),
  address: document.querySelector("#address-display"),
  message: document.querySelector("#message"),
  start: document.querySelector("#start-button"),
  next: document.querySelector("#next-button"),
  help: document.querySelector("#help-button"),
  targetOverlay: document.querySelector("#target-overlay"),
  targetOverlayAddress: document.querySelector("#target-overlay-address"),
  instructionsModal: document.querySelector("#instructions-modal"),
  closeHelp: document.querySelector("#close-help-button"),
  startPlaying: document.querySelector("#start-playing-button"),
  difficultyOptions: document.querySelectorAll(".difficulty-option"),
  paceOptions: document.querySelectorAll(".pace-option"),
};

let round = 1;
let totalScore = 0;
let roundSquares = [];
let targetSquare = null;
let acceptingGuess = false;
let selectedDifficulty = "beginner";
let selectedPace = "relaxed";

function setHud(phase, address, message) {
  els.phase.textContent = phase;
  els.address.textContent = address;
  els.message.textContent = message;
}

function showTargetOverlay(words) {
  els.targetOverlayAddress.textContent = `///${words}`;
  els.targetOverlay.hidden = false;
}

function hideTargetOverlay() {
  els.targetOverlay.hidden = true;
  els.targetOverlayAddress.textContent = "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomFrom(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function randomPointInBounds(bounds, padding = playableBoundsPadding) {
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const latSpan = north - south;
  const lngSpan = east - west;
  const latRange = 1 - padding.top - padding.bottom;
  const lngRange = 1 - padding.left - padding.right;

  return {
    lat: south + latSpan * (padding.bottom + Math.random() * latRange),
    lng: west + lngSpan * (padding.left + Math.random() * lngRange),
  };
}

function boundsToBBox(bounds) {
  return [
    bounds.getSouth().toFixed(7),
    bounds.getWest().toFixed(7),
    bounds.getNorth().toFixed(7),
    bounds.getEast().toFixed(7),
  ].join(",");
}

function squareLeafletBounds(square) {
  return [
    [square.southwest.lat, square.southwest.lng],
    [square.northeast.lat, square.northeast.lng],
  ];
}

function drawSquare(square, options) {
  return L.rectangle(squareLeafletBounds(square), {
    color: options.color,
    fillColor: options.fillColor,
    fillOpacity: options.fillOpacity ?? 0.45,
    opacity: options.opacity ?? 1,
    weight: options.weight ?? 2,
    interactive: false,
  });
}

function drawStudyLabel(square, words) {
  const center = [
    (square.southwest.lat + square.northeast.lat) / 2,
    (square.southwest.lng + square.northeast.lng) / 2,
  ];

  return L.tooltip({
    className: "study-address-label",
    direction: "right",
    offset: [12, 0],
    opacity: 1,
    permanent: true,
  })
    .setLatLng(center)
    .setContent(`///${words}`);
}

function sameSquare(a, b) {
  return a.words === b.words;
}

function setDifficulty(difficulty) {
  if (!difficulties[difficulty] || acceptingGuess) return;

  selectedDifficulty = difficulty;
  els.difficultyOptions.forEach((button) => {
    const isActive = button.dataset.difficulty === difficulty;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  map.setZoom(difficulties[difficulty].zoom, { animate: false });
}

function setDifficultyDisabled(disabled) {
  els.difficultyOptions.forEach((button) => {
    button.disabled = disabled;
  });
  els.paceOptions.forEach((button) => {
    button.disabled = disabled;
  });
}

function setStudyPace(pace) {
  if (!studyPaces[pace] || acceptingGuess) return;

  selectedPace = pace;
  els.paceOptions.forEach((button) => {
    const isActive = button.dataset.pace === pace;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function showRandomStartingArea() {
  const area = randomFrom(playableAreas);
  map.setView([area.lat, area.lng], difficulties[selectedDifficulty].zoom, { animate: false });
}

function showInstructions() {
  els.instructionsModal.classList.add("visible");
  els.startPlaying.focus();
}

function hideInstructions(nextFocus = els.help) {
  els.instructionsModal.classList.remove("visible");
  nextFocus.focus();
}

function calculateRoundScore(distance) {
  const baseScore = window.MemoryGridScoring.scoreForGridDistance(distance);
  const difficultyMultiplier = difficulties[selectedDifficulty].scoreMultiplier;
  const paceMultiplier = studyPaces[selectedPace].scoreMultiplier;
  return baseScore * difficultyMultiplier * paceMultiplier;
}

function multiplierLabel() {
  const difficultyMultiplier = difficulties[selectedDifficulty].scoreMultiplier;
  const paceMultiplier = studyPaces[selectedPace].scoreMultiplier;
  return `${difficultyMultiplier}x difficulty, ${paceMultiplier}x pace`;
}

async function getJson(url) {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "Request failed");
  }
  return body;
}

async function loadGrid() {
  layers.grid.clearLayers();
  const bbox = boundsToBBox(map.getBounds());
  const grid = await getJson(`/api/grid?bbox=${encodeURIComponent(bbox)}`);
  L.geoJSON(grid, {
    style: {
      className: "grid-line",
      color: "#df2f4f",
      opacity: 0.55,
      weight: 1,
    },
    interactive: false,
  }).addTo(layers.grid);
}

async function lookupAddress(point) {
  return getJson(`/api/address?lat=${point.lat}&lng=${point.lng}`);
}

async function pickRoundSquares() {
  const selected = [];
  let attempts = 0;

  while (selected.length < 3 && attempts < 18) {
    attempts += 1;
    const candidate = await lookupAddress(randomPointInBounds(map.getBounds()));
    if (!selected.some((existing) => sameSquare(existing, candidate))) {
      selected.push(candidate);
    }
  }

  if (selected.length < 3) {
    throw new Error("Could not find three distinct what3words squares");
  }

  return selected;
}

async function showStudySequence(squares) {
  for (const [index, square] of squares.entries()) {
    layers.study.clearLayers();
    drawSquare(square.square, {
      color: "#ffffff",
      fillColor: "#df2f4f",
      fillOpacity: 0.88,
      weight: 2,
    }).addTo(layers.study);
    drawStudyLabel(square.square, square.words).addTo(layers.study);

    setHud(
      `Study ${index + 1} of 3`,
      `Square ${index + 1}`,
      "Read the address beside the highlighted square on the map."
    );

    await sleep(studyPaces[selectedPace].flashMs);
  }
  layers.study.clearLayers();
}

async function startRound() {
  acceptingGuess = false;
  els.start.disabled = true;
  els.next.disabled = true;
  setDifficultyDisabled(true);
  layers.study.clearLayers();
  layers.result.clearLayers();
  hideTargetOverlay();

  try {
    setHud("Loading", "Preparing map", "Loading the what3words grid.");
    const area = randomFrom(playableAreas);
    const difficulty = difficulties[selectedDifficulty];
    map.setView([area.lat, area.lng], difficulty.zoom, { animate: false });
    map.invalidateSize();
    await sleep(150);
    await loadGrid();
    const pace = studyPaces[selectedPace];
    setHud(
      "Loading",
      "Choosing squares",
      `${difficulty.label} round ${round} is in ${area.name}. Study pace: ${pace.label}.`
    );
    roundSquares = await pickRoundSquares();
    await showStudySequence(roundSquares);
    targetSquare = randomFrom(roundSquares);
    acceptingGuess = true;
    showTargetOverlay(targetSquare.words);
    setHud(
      "Find this square",
      "Use the map overlay",
      "Click the grid square where you saw the address shown on the map."
    );
  } catch (error) {
    hideTargetOverlay();
    setHud("Problem", "Round failed", error.message);
    els.start.disabled = false;
    setDifficultyDisabled(false);
  }
}

function formatDistance(distance) {
  return distance === 1 ? "1 square away" : `${distance} squares away`;
}

async function handleGuess(event) {
  if (!acceptingGuess || !targetSquare) return;

  acceptingGuess = false;
  hideTargetOverlay();
  setHud("Checking", "Checking click", "Resolving your clicked square.");

  try {
    const selected = await lookupAddress(event.latlng);
    const distance = window.MemoryGridScoring.gridDistance(targetSquare.square, selected.square);
    const score = calculateRoundScore(distance);
    totalScore += score;
    els.totalScore.textContent = String(totalScore);

    layers.result.clearLayers();
    drawSquare(targetSquare.square, {
      color: "#0b6f49",
      fillColor: "#16845a",
      fillOpacity: 0.56,
      weight: 4,
    }).addTo(layers.result);

    drawSquare(selected.square, {
      color: "#174f91",
      fillColor: "#2368b8",
      fillOpacity: 0.42,
      weight: 3,
    }).addTo(layers.result);

    const distanceText = distance === 0 ? "Exact match" : formatDistance(distance);
    setHud(
      "Result",
      `${score} points`,
      `${distanceText}. ${multiplierLabel()}.`
    );
    els.next.disabled = false;
    setDifficultyDisabled(false);
  } catch (error) {
    showTargetOverlay(targetSquare.words);
    setHud("Problem", "Try again", error.message);
    acceptingGuess = true;
  }
}

function nextRound() {
  round += 1;
  els.round.textContent = String(round);
  startRound();
}

setDifficulty("beginner");
setStudyPace("relaxed");
showRandomStartingArea();
els.difficultyOptions.forEach((button) => {
  button.addEventListener("click", () => setDifficulty(button.dataset.difficulty));
});
els.paceOptions.forEach((button) => {
  button.addEventListener("click", () => setStudyPace(button.dataset.pace));
});
els.help.addEventListener("click", showInstructions);
els.closeHelp.addEventListener("click", hideInstructions);
els.startPlaying.addEventListener("click", () => hideInstructions(els.start));
els.instructionsModal.addEventListener("click", (event) => {
  if (event.target === els.instructionsModal) {
    hideInstructions();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && els.instructionsModal.classList.contains("visible")) {
    hideInstructions();
  }
});
els.start.addEventListener("click", startRound);
els.next.addEventListener("click", nextRound);
map.on("click", handleGuess);
showInstructions();
