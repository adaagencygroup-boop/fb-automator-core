import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSelectedPagesForSave, saveBlobFile, saveCsvContent } from "./saveFile.mjs";

function makeFakeDom() {
  const clicks = [];
  const revoked = [];
  return {
    clicks,
    revoked,
    doc: {
      body: { appendChild() {}, removeChild() {} },
      createElement() {
        const el = {
          href: "",
          download: "",
          click() {
            clicks.push({ href: el.href, download: el.download });
          },
        };
        return el;
      },
    },
    urlApi: {
      createObjectURL: () => "blob:mock-1",
      revokeObjectURL: (u) => revoked.push(u),
    },
  };
}

test("saveBlobFile returns saved only after showSaveFilePicker writes and closes", async () => {
  const writtenBytes = [];
  const writtenText = [];
  let closed = false;
  const win = {
    async showSaveFilePicker(opts) {
      assert.equal(opts.suggestedName, "pages.csv");
      return {
        name: "my_pages.csv",
        async createWritable() {
          return {
            async write(blob) {
              writtenBytes.push(Array.from(new Uint8Array(await blob.arrayBuffer())));
              writtenText.push(await blob.text());
            },
            async close() {
              closed = true;
            },
          };
        },
      };
    },
  };
  const dom = makeFakeDom();
  const res = await saveCsvContent("A,B\n1,2", "pages.csv", { win, ...dom });
  assert.deepEqual(res, { status: "saved", fileName: "my_pages.csv" });
  assert.equal(closed, true);
  // 3 byte đầu phải là UTF-8 BOM (EF BB BF) để Excel đọc đúng tiếng Việt; Blob.text() tự bỏ BOM theo chuẩn Web
  assert.deepEqual(writtenBytes[0].slice(0, 3), [0xef, 0xbb, 0xbf]);
  assert.equal(writtenText[0], "A,B\n1,2");
  assert.equal(dom.clicks.length, 0);
});

test("saveBlobFile returns cancelled on AbortError without triggering browser download", async () => {
  const win = {
    async showSaveFilePicker() {
      const err = new Error("User cancelled");
      err.name = "AbortError";
      throw err;
    },
  };
  const dom = makeFakeDom();
  const res = await saveCsvContent("A,B", "pages.csv", { win, ...dom });
  assert.deepEqual(res, { status: "cancelled", fileName: "pages.csv" });
  assert.equal(dom.clicks.length, 0);
});

test("saveBlobFile falls back to anchor download when showSaveFilePicker is unavailable", async () => {
  const dom = makeFakeDom();
  const res = await saveBlobFile(new Blob(["hi"]), { suggestedName: "f.csv", win: {}, ...dom });
  assert.deepEqual(res, { status: "downloaded", fileName: "f.csv" });
  assert.equal(dom.clicks.length, 1);
  assert.equal(dom.clicks[0].download, "f.csv");
  assert.deepEqual(dom.revoked, ["blob:mock-1"]);
});

test("saveBlobFile falls back to anchor download on non-Abort picker error", async () => {
  const win = {
    async showSaveFilePicker() {
      const err = new Error("User activation required");
      err.name = "SecurityError";
      throw err;
    },
  };
  const dom = makeFakeDom();
  const res = await saveCsvContent("\uFEFFA,B", "pages.csv", { win, ...dom });
  assert.deepEqual(res, { status: "downloaded", fileName: "pages.csv" });
  assert.equal(dom.clicks.length, 1);
});

test("pickSelectedPagesForSave rejects when no page is checked", () => {
  const pages = [{ page_key: "p1" }, { page_key: "p2" }];
  assert.deepEqual(pickSelectedPagesForSave(pages, []), {
    ok: false,
    keys: [],
    reason: "empty_selection",
  });
});

test("pickSelectedPagesForSave returns only checked pages present in current results", () => {
  const pages = [{ page_key: "p1" }, { page_key: "p2" }, { page_key: "p3" }];
  assert.deepEqual(pickSelectedPagesForSave(pages, ["p2", "p999", "p2"]), {
    ok: true,
    keys: ["p2"],
    reason: null,
  });
  assert.deepEqual(pickSelectedPagesForSave(pages, ["p999"]), {
    ok: false,
    keys: [],
    reason: "no_matching_pages",
  });
});
