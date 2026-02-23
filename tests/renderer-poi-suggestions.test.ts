import test from "node:test";
import assert from "node:assert/strict";

import { parsePoiSuggestionsFromAsset } from "../renderer/src/shared/poiSuggestions";

test("parsePoiSuggestionsFromAsset parses valid POI presets", () => {
  const parsed = parsePoiSuggestionsFromAsset([
    {
      button_text: "Water flow check point",
      name: {
        de: "Stelle f\u00fcr Wasserstandskontrolle",
        en: "Water flow check point",
        es: "Punto de control del caudal",
        fr: "Point de contr\u00f4le du d\u00e9bit",
        it: "Punto di controllo della portata",
        pt: "Ponto de controlo do caudal",
      },
      description: {
        de: "Vor Einstieg, hier Wasserstand kontrollieren.",
        en: "Before entry, check the water level here.",
        es: "Antes del inicio, comprobar aqu\u00ed el nivel del agua.",
        fr: "Avant l'entr\u00e9e, v\u00e9rifier ici le niveau d'eau.",
        it: "Prima dell'ingresso, controllare qui il livello dell'acqua.",
        pt: "Antes da entrada, verificar aqui o n\u00edvel da \u00e1gua.",
      },
    },
  ]);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.buttonText, "Water flow check point");
  assert.equal(parsed[0]?.name.en, "Water flow check point");
  assert.equal(parsed[0]?.description.en, "Before entry, check the water level here.");
});

test("parsePoiSuggestionsFromAsset skips invalid entries", () => {
  const parsed = parsePoiSuggestionsFromAsset([
    null,
    {
      button_text: "  ",
      name: {
        de: "",
        en: "",
        es: "",
        fr: "",
        it: "",
        pt: "",
      },
      description: {
        de: "",
        en: "",
        es: "",
        fr: "",
        it: "",
        pt: "",
      },
    },
    {
      button_text: "Missing description",
      name: {
        de: "",
        en: "",
        es: "",
        fr: "",
        it: "",
        pt: "",
      },
    },
    {
      button_text: "Wrong language payload",
      name: {
        de: "",
        en: "",
        es: "",
        fr: "",
        it: "",
        pt: "",
        nl: "",
      },
      description: {
        de: "",
        en: "",
        es: "",
        fr: "",
        it: "",
        pt: "",
      },
    },
    {
      button_text: "Valid preset",
      name: {
        de: "Name DE",
        en: "Name EN",
        es: "Name ES",
        fr: "Name FR",
        it: "Name IT",
        pt: "Name PT",
      },
      description: {
        de: "Desc DE",
        en: "Desc EN",
        es: "Desc ES",
        fr: "Desc FR",
        it: "Desc IT",
        pt: "Desc PT",
      },
    },
  ]);

  assert.deepEqual(parsed, [
    {
      buttonText: "Valid preset",
      name: {
        de: "Name DE",
        en: "Name EN",
        es: "Name ES",
        fr: "Name FR",
        it: "Name IT",
        pt: "Name PT",
      },
      description: {
        de: "Desc DE",
        en: "Desc EN",
        es: "Desc ES",
        fr: "Desc FR",
        it: "Desc IT",
        pt: "Desc PT",
      },
    },
  ]);
});

test("parsePoiSuggestionsFromAsset returns empty array for non-array payloads", () => {
  assert.deepEqual(parsePoiSuggestionsFromAsset(null), []);
  assert.deepEqual(parsePoiSuggestionsFromAsset({}), []);
  assert.deepEqual(parsePoiSuggestionsFromAsset("[]"), []);
});

test("parsePoiSuggestionsFromAsset keeps order and special characters", () => {
  const parsed = parsePoiSuggestionsFromAsset([
    {
      button_text: "First",
      name: {
        de: "Gro\u00dfer Parkplatz",
        en: "Big parking lot",
        es: "Gran estacionamiento",
        fr: "Grand parking",
        it: "Grande parcheggio",
        pt: "Grande estacionamento",
      },
      description: {
        de: "Stra\u00dfe",
        en: "Road",
        es: "Ca\u00f1\u00f3n",
        fr: "Entr\u00e9e \u00e0 l'eau",
        it: "Ingresso all'acqua",
        pt: "C\u00e2nion",
      },
    },
    {
      button_text: "Second",
      name: {
        de: "Name 2 DE",
        en: "Name 2 EN",
        es: "Name 2 ES",
        fr: "Name 2 FR",
        it: "Name 2 IT",
        pt: "Name 2 PT",
      },
      description: {
        de: "Desc 2 DE",
        en: "Desc 2 EN",
        es: "Desc 2 ES",
        fr: "Desc 2 FR",
        it: "Desc 2 IT",
        pt: "Desc 2 PT",
      },
    },
  ]);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.buttonText, "First");
  assert.equal(parsed[0]?.name.de, "Gro\u00dfer Parkplatz");
  assert.equal(parsed[0]?.description.es, "Ca\u00f1\u00f3n");
  assert.equal(parsed[0]?.description.fr, "Entr\u00e9e \u00e0 l'eau");
  assert.equal(parsed[0]?.description.pt, "C\u00e2nion");
  assert.equal(parsed[1]?.buttonText, "Second");
});
