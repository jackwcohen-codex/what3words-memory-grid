(function attachScoring(global) {
  function squareCenter(square) {
    return {
      lat: (square.southwest.lat + square.northeast.lat) / 2,
      lng: (square.southwest.lng + square.northeast.lng) / 2,
    };
  }

  function squareSize(square) {
    return {
      lat: Math.abs(square.northeast.lat - square.southwest.lat),
      lng: Math.abs(square.northeast.lng - square.southwest.lng),
    };
  }

  function gridDistance(targetSquare, selectedSquare) {
    const targetCenter = squareCenter(targetSquare);
    const selectedCenter = squareCenter(selectedSquare);
    const targetSize = squareSize(targetSquare);
    const selectedSize = squareSize(selectedSquare);
    const latStep = (targetSize.lat + selectedSize.lat) / 2;
    const lngStep = (targetSize.lng + selectedSize.lng) / 2;

    if (!latStep || !lngStep) {
      return Number.POSITIVE_INFINITY;
    }

    const rowOffset = Math.round(Math.abs(selectedCenter.lat - targetCenter.lat) / latStep);
    const colOffset = Math.round(Math.abs(selectedCenter.lng - targetCenter.lng) / lngStep);
    return Math.max(rowOffset, colOffset);
  }

  function scoreForGridDistance(distance) {
    if (distance === 0) return 100;
    if (distance === 1) return 80;
    if (distance === 2) return 60;
    if (distance === 3) return 40;
    if (distance <= 5) return 20;
    return 0;
  }

  global.MemoryGridScoring = {
    gridDistance,
    scoreForGridDistance,
  };

  if (typeof module !== "undefined") {
    module.exports = global.MemoryGridScoring;
  }
})(typeof window !== "undefined" ? window : globalThis);
