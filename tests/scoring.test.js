const assert = require("assert");
const { gridDistance, scoreForGridDistance } = require("../public/scoring");

const baseSquare = {
  southwest: { lat: 10, lng: 20 },
  northeast: { lat: 10.00003, lng: 20.00003 },
};

function shiftedSquare(rowOffset, colOffset) {
  const latStep = baseSquare.northeast.lat - baseSquare.southwest.lat;
  const lngStep = baseSquare.northeast.lng - baseSquare.southwest.lng;
  return {
    southwest: {
      lat: baseSquare.southwest.lat + rowOffset * latStep,
      lng: baseSquare.southwest.lng + colOffset * lngStep,
    },
    northeast: {
      lat: baseSquare.northeast.lat + rowOffset * latStep,
      lng: baseSquare.northeast.lng + colOffset * lngStep,
    },
  };
}

assert.strictEqual(gridDistance(baseSquare, shiftedSquare(0, 0)), 0);
assert.strictEqual(gridDistance(baseSquare, shiftedSquare(1, 0)), 1);
assert.strictEqual(gridDistance(baseSquare, shiftedSquare(0, -1)), 1);
assert.strictEqual(gridDistance(baseSquare, shiftedSquare(1, 1)), 1);
assert.strictEqual(gridDistance(baseSquare, shiftedSquare(2, 1)), 2);
assert.strictEqual(gridDistance(baseSquare, shiftedSquare(-3, 3)), 3);
assert.strictEqual(gridDistance(baseSquare, shiftedSquare(5, 4)), 5);
assert.strictEqual(gridDistance(baseSquare, shiftedSquare(6, 0)), 6);

assert.strictEqual(scoreForGridDistance(0), 100);
assert.strictEqual(scoreForGridDistance(1), 80);
assert.strictEqual(scoreForGridDistance(2), 60);
assert.strictEqual(scoreForGridDistance(3), 40);
assert.strictEqual(scoreForGridDistance(4), 20);
assert.strictEqual(scoreForGridDistance(5), 20);
assert.strictEqual(scoreForGridDistance(6), 0);

console.log("Scoring tests passed");
