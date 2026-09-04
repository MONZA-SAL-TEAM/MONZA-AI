/**
 * Storage path validation — the traversal boundary.
 *
 * The service-role key can write anywhere in the project's storage, so the only
 * thing standing between a request body and an arbitrary object path is
 * parseMediaPath(). It used to exist in two copies (route and browser store)
 * that had already drifted apart; there is one now, and this is it under test.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWED_CONTENT_TYPES,
  buildMediaPath,
  checkUpload,
  contentTypeFor,
  displayNameOf,
  extensionOf,
  isValidCarId,
  mediaPrefix,
  parseMediaPath,
  safeObjectName,
} from "@/lib/wasales/media-paths";

describe("parseMediaPath accepts only well-formed paths", () => {
  test("a normal upload path parses into its three parts", () => {
    const p = parseMediaPath("voyah-free/video/abc123__walkaround.mp4");
    assert.deepEqual(p, {
      carId: "voyah-free",
      kind: "video",
      objectName: "abc123__walkaround.mp4",
    });
  });

  test("both kinds are recognised and nothing else is", () => {
    assert.ok(parseMediaPath("car/video/a.mp4"));
    assert.ok(parseMediaPath("car/brochure/a.pdf"));
    assert.equal(parseMediaPath("car/photo/a.jpg"), null);
    assert.equal(parseMediaPath("car/VIDEO/a.mp4"), null);
  });
});

describe("parseMediaPath refuses traversal", () => {
  const attacks = [
    "../secrets/video/x.mp4",
    "car/../../video/x.mp4",
    "car/video/../../../etc/passwd",
    "..",
    "../..",
    "car/video/..",
    "car/video/.",
    "/car/video/x.mp4",
    "car//video/x.mp4",
    "car/video/x.mp4/",
    "car/video/sub/dir/x.mp4",
  ];

  for (const attack of attacks) {
    test(`refuses ${JSON.stringify(attack)}`, () => {
      assert.equal(parseMediaPath(attack), null);
    });
  }

  test("refuses an encoded separator rather than decoding it", () => {
    // The path is used verbatim as a storage key; nothing here un-escapes, so
    // an encoded slash must simply fail the character class.
    assert.equal(parseMediaPath("car/video/..%2F..%2Fsecret.mp4"), null);
  });

  test("refuses a dot-only or dot-leading object name", () => {
    assert.equal(parseMediaPath("car/video/..."), null);
    assert.equal(parseMediaPath("car/video/.hidden.mp4"), null);
  });
});

describe("parseMediaPath refuses malformed input", () => {
  test("non-strings are refused without throwing", () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      assert.equal(parseMediaPath(bad), null);
    }
  });

  test("an empty or over-long path is refused", () => {
    assert.equal(parseMediaPath(""), null);
    assert.equal(parseMediaPath(`car/video/${"a".repeat(400)}.mp4`), null);
  });

  test("an over-long car id is refused", () => {
    assert.equal(parseMediaPath(`${"c".repeat(65)}/video/a.mp4`), null);
  });
});

describe("car ids", () => {
  test("accepts the shapes a real source system produces", () => {
    // The old route-side rule was /^[a-z0-9-]+$/, which would have rejected
    // every one of these the moment catalog ids came from the CRM.
    for (const id of ["voyah-free", "MHERO_917", "Car42", "a"]) {
      assert.equal(isValidCarId(id), true, id);
    }
  });

  test("rejects anything that could change the path's shape", () => {
    for (const id of ["", "..", ".", "a/b", "a b", "a.b", "a%2Fb"]) {
      assert.equal(isValidCarId(id), false, JSON.stringify(id));
    }
  });
});

describe("checkUpload — the type and extension must agree", () => {
  test("a valid video upload passes", () => {
    const r = checkUpload("car/video/u__clip.mp4", "video/mp4");
    assert.equal(r.ok, true);
  });

  test("a valid brochure upload passes", () => {
    const r = checkUpload("car/brochure/u__spec.pdf", "application/pdf");
    assert.equal(r.ok, true);
  });

  test("a PDF declared as video is refused", () => {
    const r = checkUpload("car/video/u__spec.pdf", "video/mp4");
    assert.equal(r.ok, false);
  });

  test("a video declared as PDF is refused", () => {
    const r = checkUpload("car/brochure/u__clip.mp4", "application/pdf");
    assert.equal(r.ok, false);
  });

  test("a video file placed under the brochure kind is refused", () => {
    const r = checkUpload("car/brochure/u__clip.mp4", "video/mp4");
    assert.equal(r.ok, false);
  });

  test("an extension that disagrees with the declared type is refused", () => {
    // .mov with video/mp4: both are individually allowed, together they lie.
    const r = checkUpload("car/video/u__clip.mov", "video/mp4");
    assert.equal(r.ok, false);
  });

  test("types outside the bucket allowlist are refused", () => {
    for (const type of [
      "text/html",
      "image/svg+xml",
      "application/javascript",
      "application/octet-stream",
      "",
    ]) {
      assert.equal(
        checkUpload("car/video/u__clip.mp4", type).ok,
        false,
        type || "(empty)"
      );
    }
  });

  test("the content type is matched case-insensitively and trimmed", () => {
    assert.equal(checkUpload("car/video/u__c.mp4", " VIDEO/MP4 ").ok, true);
  });

  test("a traversal path is refused before the type is even considered", () => {
    const r = checkUpload("../../x/video/c.mp4", "video/mp4");
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, "Invalid file path.");
  });

  test("the allowlist is exactly the bucket's", () => {
    assert.deepEqual([...ALLOWED_CONTENT_TYPES].sort(), [
      "application/pdf",
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "video/x-matroska",
    ]);
  });
});

describe("names", () => {
  test("extensionOf is lowercase and tolerates no extension", () => {
    assert.equal(extensionOf("A.MP4"), "mp4");
    assert.equal(extensionOf("noextension"), "");
  });

  test("contentTypeFor maps known extensions and nothing else", () => {
    assert.equal(contentTypeFor("a.mov"), "video/quicktime");
    assert.equal(contentTypeFor("a.pdf"), "application/pdf");
    assert.equal(contentTypeFor("a.exe"), "");
  });

  test("safeObjectName keeps the extension and strips everything unsafe", () => {
    assert.equal(safeObjectName("Voyah Free (2025).mp4"), "Voyah-Free-2025.mp4");
  });

  test("safeObjectName sanitises the EXTENSION too, not just the base", () => {
    // extensionOf() is "everything after the last dot", so this name's
    // "extension" is "/etc/passwd". Sanitising only the base used to emit a
    // name containing separators.
    const name = safeObjectName("../../etc/passwd");
    assert.ok(!name.includes("/"), name);
    assert.notEqual(parseMediaPath(`car/video/${name}`), null);
  });

  test("safeObjectName always returns something a path can hold", () => {
    for (const input of ["", "...", "///", "!!!"]) {
      const name = safeObjectName(input);
      assert.ok(
        parseMediaPath(`car/video/${name}`) !== null,
        `${JSON.stringify(input)} produced ${JSON.stringify(name)}`
      );
    }
  });

  test("safeObjectName collapses underscore runs so the display split holds", () => {
    // The display name is everything after the FIRST "__" — a name that
    // introduced its own "__" would make that split ambiguous.
    const built = buildMediaPath("car", "video", "uuid", "my__file.mp4");
    const parsed = parseMediaPath(built);
    assert.ok(parsed);
    assert.equal(displayNameOf(parsed.objectName), "my_file.mp4");
  });

  test("a built path always parses, for any original file name", () => {
    for (const name of [
      "clip.mp4",
      "  spaced name .mp4",
      "أسطورة.mp4",
      "..\\..\\windows\\system32.mp4",
      "a".repeat(300) + ".mp4",
    ]) {
      const built = buildMediaPath("voyah-free", "video", "abc", name);
      assert.notEqual(parseMediaPath(built), null, name.slice(0, 30));
    }
  });

  test("displayNameOf falls back to the whole name when there is no separator", () => {
    assert.equal(displayNameOf("plain.mp4"), "plain.mp4");
  });

  test("mediaPrefix builds the listing prefix", () => {
    assert.equal(mediaPrefix("voyah-free", "brochure"), "voyah-free/brochure");
  });
});
