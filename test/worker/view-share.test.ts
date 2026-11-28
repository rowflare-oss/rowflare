import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { addViewer, HttpClient, ownerWithBase } from "./helpers";

async function setup(prefix: string) {
  const o = await ownerWithBase(prefix);
  const t = await o.c.req("POST", `/api/bases/${o.baseId}/schema`, {
    op: "createTable",
    name: "People",
    emptyRows: 0,
    fields: [
      { name: "Name", type: "text" },
      { name: "Secret", type: "text" },
      { name: "Public", type: "checkbox" },
      { name: "Photo", type: "attachment" },
    ],
  });
  expect(t.status).toBe(200);
  const tableId = t.json.id as string;
  const fields = t.json.schema.fields.filter((f: any) => f.tableId === tableId);
  const fid = (name: string) => fields.find((f: any) => f.name === name).id as string;
  const v = await o.c.req("POST", `/api/bases/${o.baseId}/schema`, {
    op: "createView",
    tableId,
    view: { name: "Directory", type: "grid", config: { hidden: [fid("Secret")], filters: { conjunction: "and", conditions: [{ fieldId: fid("Public"), op: "eq", value: true }] } } },
  });
  expect(v.status).toBe(200);
  const viewId = v.json.id as string;
  const up = await SELF.fetch(`https://app.test/api/bases/${o.baseId}/attachments?name=a.png`, { method: "POST", headers: { Cookie: o.c.cookie, "x-rf": "1", "content-type": "image/png" }, body: new Uint8Array([1, 2, 3]) });
  const att = (await up.json()) as { key: string };
  const rows = await o.c.req("POST", `/api/bases/${o.baseId}/rows`, {
    op: "create",
    tableId,
    rows: [
      { cells: { [fid("Name")]: "Ava", [fid("Secret")]: "needle-ava", [fid("Public")]: true, [fid("Photo")]: [att] } },
      { cells: { [fid("Name")]: "Ben", [fid("Secret")]: "needle-ben", [fid("Public")]: false, [fid("Photo")]: [att] } },
    ],
  });
  expect(rows.status).toBe(200);
  const ids = (await o.c.req("POST", `/api/bases/${o.baseId}/query`, { tableId, limit: 0 })).json.ids as number[];
  return { ...o, tableId, viewId, fid, att, ids, share: `/api/bases/${o.baseId}/views/${viewId}/share` };
}

describe("read-only view links", () => {
  it("shows only visible fields and records the view keeps, to anyone with the link", async () => {
    const s = await setup("vshare1");
    expect((await s.c.req("GET", s.share)).json).toEqual({ shareId: null, url: null });
    const created = await s.c.req("POST", s.share, {});
    expect(created.status).toBe(200);
    expect(created.json.url).toBe(`https://app.test/share/${created.json.shareId}`);
    // Creating again keeps the same link.
    expect((await s.c.req("POST", s.share, {})).json.shareId).toBe(created.json.shareId);

    const anon = new HttpClient();
    const page = await anon.req("GET", `/api/shared/${created.json.shareId}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.json.title).toBe("Directory");
    expect(page.json.table).toBe("People");
    expect(page.json.fields.map((f: any) => f.name)).toEqual(["Name", "Public", "Photo"]);
    expect(page.json.total).toBe(1);
    expect(page.json.rows).toHaveLength(1);
    expect(page.json.rows[0].cells[s.fid("Name")]).toBe("Ava");
    expect(JSON.stringify(page.json)).not.toContain("needle");
  });

  it("does not let search reach hidden fields", async () => {
    const s = await setup("vshare2");
    const id = (await s.c.req("POST", s.share, {})).json.shareId;
    const anon = new HttpClient();
    expect((await anon.req("GET", `/api/shared/${id}?q=Ava`)).json.total).toBe(1);
    expect((await anon.req("GET", `/api/shared/${id}?q=needle`)).json.total).toBe(0);
    expect((await anon.req("GET", `/api/shared/${id}?q=Ben`)).json.total).toBe(0);
  });

  it("serves attachments only of records and fields the view shows", async () => {
    const s = await setup("vshare3");
    const id = (await s.c.req("POST", s.share, {})).json.shareId;
    const anon = new HttpClient();
    const enc = s.att.key.split("/").map(encodeURIComponent).join("/");
    const [ava, ben] = s.ids;
    const ok = await SELF.fetch(`https://app.test/api/shared/${id}/files/${ava}/${enc}`);
    expect(ok.status).toBe(200);
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    // Ben is filtered out of the view, so his copy of the file is not reachable through the link.
    expect((await anon.req("GET", `/api/shared/${id}/files/${ben}/${enc}`)).status).toBe(404);
    expect((await anon.req("GET", `/api/shared/${id}/files/${ava}/${s.baseId}/other/x.png`)).status).toBe(404);
    // The signed-in file route stays closed to anonymous visitors.
    expect((await anon.req("GET", `/api/files/${enc}`)).status).toBe(401);
    // Hiding the field closes it too.
    await s.c.req("POST", `/api/bases/${s.baseId}/schema`, { op: "updateView", viewId: s.viewId, patch: { config: { hidden: [s.fid("Secret"), s.fid("Photo")] } } });
    expect((await anon.req("GET", `/api/shared/${id}/files/${ava}/${enc}`)).status).toBe(404);
  });

  it("stops working once disabled or when the view is deleted", async () => {
    const s = await setup("vshare4");
    const anon = new HttpClient();
    const first = (await s.c.req("POST", s.share, {})).json.shareId;
    expect((await s.c.req("DELETE", s.share)).status).toBe(200);
    expect((await anon.req("GET", `/api/shared/${first}`)).status).toBe(404);
    const second = (await s.c.req("POST", s.share, {})).json.shareId;
    expect(second).not.toBe(first);
    await s.c.req("POST", `/api/bases/${s.baseId}/schema`, { op: "deleteView", viewId: s.viewId });
    const gone = await anon.req("GET", `/api/shared/${second}`);
    expect(gone.status).toBe(404);
    expect(gone.json.error).toBe("This link is no longer available");
  });

  it("lets viewers see the link but not create or disable it", async () => {
    const s = await setup("vshare5");
    const viewer = new HttpClient(await addViewer(s.c, s.wsId, "vshare5-viewer@example.com"));
    expect((await viewer.req("POST", s.share, {})).status).toBe(403);
    const id = (await s.c.req("POST", s.share, {})).json.shareId;
    expect((await viewer.req("GET", s.share)).json.shareId).toBe(id);
    expect((await viewer.req("DELETE", s.share)).status).toBe(403);
    expect((await new HttpClient().req("GET", s.share)).status).toBe(401);
  });

  it("keeps form links and view links apart", async () => {
    const s = await setup("vshare6");
    const form = await s.c.req("POST", `/api/bases/${s.baseId}/schema`, { op: "createView", tableId: s.tableId, view: { name: "Join", type: "form" } });
    expect((await s.c.req("POST", `/api/bases/${s.baseId}/views/${form.json.id}/share`, {})).status).toBe(404);
    const formShare = (await s.c.req("POST", `/api/bases/${s.baseId}/forms`, { viewId: form.json.id })).json.shareId;
    const anon = new HttpClient();
    expect((await anon.req("GET", `/api/shared/${formShare}`)).status).toBe(404);
    const viewShare = (await s.c.req("POST", s.share, {})).json.shareId;
    expect((await anon.req("GET", `/api/forms/${viewShare}`)).status).toBe(404);
    expect((await anon.req("POST", `/api/forms/${viewShare}`, { cells: {} })).status).toBe(404);
  });
});
