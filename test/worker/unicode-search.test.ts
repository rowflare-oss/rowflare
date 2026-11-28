import { describe, expect, it } from "vitest";
import { ownerWithBase } from "./helpers";

const PLACES = ["Östersund", "MALMÖ", "Åre", "Ängelholm", "Göteborg", "Malmo", "Rönnskär"];

async function setup(prefix: string) {
  const o = await ownerWithBase(prefix);
  const t = await o.c.req("POST", `/api/bases/${o.baseId}/schema`, { op: "createTable", name: "Places", emptyRows: 0, fields: [{ name: "Name", type: "text" }, { name: "Tags", type: "multiSelect" }] });
  expect(t.status).toBe(200);
  const tableId = t.json.id as string;
  const name = t.json.schema.fields.find((f: any) => f.tableId === tableId && f.name === "Name").id as string;
  const created = await o.c.req("POST", `/api/bases/${o.baseId}/rows`, { op: "create", tableId, rows: PLACES.map(p => ({ cells: { [name]: p } })) });
  expect(created.status).toBe(200);
  const names = async (q: Record<string, unknown>) => {
    const r = await o.c.req("POST", `/api/bases/${o.baseId}/query`, { tableId, limit: 100, ...q });
    expect(r.status).toBe(200);
    return r.json.rows.map((row: any) => row.cells[name]).sort();
  };
  const where = (op: string, value: string) => names({ filters: { conjunction: "and", conditions: [{ fieldId: name, op, value }] } });
  return { ...o, tableId, name, names, where };
}

describe("case-insensitive matching beyond ASCII", () => {
  it("search folds the case of å, ä and ö but keeps them apart from a and o", async () => {
    const s = await setup("uni1");
    expect(await s.names({ search: "ö" })).toEqual(["Göteborg", "MALMÖ", "Rönnskär", "Östersund"].sort());
    expect(await s.names({ search: "ÖSTER" })).toEqual(["Östersund"]);
    expect(await s.names({ search: "malmö" })).toEqual(["MALMÖ"]);
    expect(await s.names({ search: "åre" })).toEqual(["Åre"]);
    expect(await s.names({ search: "ängel" })).toEqual(["Ängelholm"]);
    // Distinct letters in Swedish: o does not match ö.
    expect(await s.names({ search: "malmo" })).toEqual(["Malmo"]);
  });

  it("stores decomposed text composed, so it matches what people type", async () => {
    const s = await setup("uni2");
    expect(await s.names({ search: "röNN" })).toEqual(["Rönnskär"]);
    expect((await s.names({})).includes("Rönnskär")).toBe(true);
  });

  it("filters compare the same way", async () => {
    const s = await setup("uni3");
    expect(await s.where("contains", "ä")).toEqual(["Rönnskär", "Ängelholm"].sort());
    expect(await s.where("eq", "östersund")).toEqual(["Östersund"]);
    expect(await s.where("eq", "MALMÖ")).toEqual(["MALMÖ"]);
    expect((await s.where("neq", "åre")).includes("Åre")).toBe(false);
    expect((await s.where("ncontains", "Ö")).sort()).toEqual(["Malmo", "Åre", "Ängelholm"].sort());
  });

  it("typecast links find records whatever the case of their name", async () => {
    const s = await setup("uni4");
    const f = await s.c.req("POST", `/api/bases/${s.baseId}/schema`, { op: "createTable", name: "Trips", emptyRows: 0, fields: [{ name: "Trip", type: "text" }] });
    const trips = f.json.id as string;
    const link = await s.c.req("POST", `/api/bases/${s.baseId}/schema`, { op: "createField", tableId: trips, field: { name: "Place", type: "link", options: { linkedTableId: s.tableId } } });
    expect(link.status).toBe(200);
    const before = (await s.names({})).length;
    const r = await s.c.req("POST", `/api/bases/${s.baseId}/rows`, { op: "create", tableId: trips, typecast: true, rows: [{ cells: { [link.json.id]: ["östersund"] } }] });
    expect(r.status).toBe(200);
    expect((await s.names({})).length).toBe(before);
  });
});
