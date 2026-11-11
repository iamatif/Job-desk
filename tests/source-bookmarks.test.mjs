import { test } from "node:test";
import assert from "node:assert/strict";
import {
  savedSourceIds,
  toggleSavedSource,
} from "../public/source-bookmarks.js";
test("a source bookmark toggles on, then off, without changing other bookmarks", () => {
  const saved = toggleSavedSource(undefined, "indeed");
  assert.deepEqual(saved, ["indeed"]);
  assert.deepEqual(toggleSavedSource(saved, "indeed"), []);
  assert.deepEqual(toggleSavedSource(["rozee"], "indeed"), ["rozee", "indeed"]);
});
test("old or invalid saved-source state cannot break the source cards", () => {
  assert.deepEqual(savedSourceIds(null), []);
  assert.deepEqual(savedSourceIds({ indeed: true }), []);
  assert.deepEqual(savedSourceIds(["indeed", "indeed", "unknown"]), ["indeed"]);
});
test("only supported sources can be bookmarked", () => {
  assert.throws(() => toggleSavedSource([], "unknown"), RangeError);
});
test('expanded source bookmarks retain existing boards and the new remote platforms',()=>{
 const ids=['linkedin','himalayas','jobicy','remoteok','wwr','remotive','wordpress'];
 assert.deepEqual(savedSourceIds(['indeed',...ids]),['indeed',...ids]);
 for(const id of ids)assert.deepEqual(toggleSavedSource(['rozee'],id),['rozee',id]);
});
