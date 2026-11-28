// A view opened through its read-only share link: the view's visible fields as a table, with search and paging.
import { useEffect, useMemo, useRef, useState } from "react";
import { get } from "../api";
import { CellDisplay, type EditorContext } from "../base/editors";
import { Icon, Logo, Spinner } from "../ui";
import type { Attachment, Member, SharedViewPage } from "../../shared/types";
import "./pages.css";

type Row = SharedViewPage["rows"][number];

export default function SharedView({ shareId }: { shareId: string }) {
  const [page, setPage] = useState<SharedViewPage | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<Member[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(0);
  const base = `/api/shared/${encodeURIComponent(shareId)}`;

  const load = (q: string, offset: number) => {
    const n = ++latest.current;
    setBusy(true);
    get<SharedViewPage>(`${base}?q=${encodeURIComponent(q)}&offset=${offset}`)
      .then(p => {
        if (n !== latest.current) return;
        setPage(p);
        setRows(r => (offset ? [...r, ...p.rows] : p.rows));
        setUsers(u => {
          const known = new Map(u.map(m => [m.id, m]));
          for (const x of p.users) known.set(x.id, { id: x.id, name: x.name, email: "", role: "viewer" });
          return [...known.values()];
        });
        document.title = `${p.title} - ${p.table} - Rowflare`;
      })
      .catch(e => n === latest.current && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => n === latest.current && setBusy(false));
  };

  useEffect(() => load(search, 0), [shareId, search]);

  const ctxFor = useMemo(() => {
    const cache = new Map<number, EditorContext>();
    return (rowId: number): EditorContext => {
      let ctx = cache.get(rowId);
      if (!ctx) {
        const fileUrl = (a: Attachment) => `${base}/files/${rowId}/${a.key.split("/").map(encodeURIComponent).join("/")}`;
        ctx = { members: users, fileUrl };
        cache.set(rowId, ctx);
      }
      return ctx;
    };
  }, [base, users]);

  if (error && !page) {
    return (
      <main className="pf-page">
        <div className="card pf-card">
          <div className="pf-done">
            <h1>Link unavailable</h1>
            <p>{error}</p>
          </div>
        </div>
      </main>
    );
  }
  if (!page) {
    return (
      <main className="pf-page">
        <Spinner size={24} />
      </main>
    );
  }

  const more = rows.length < page.total;
  return (
    <main className="sv-page">
      <header className="sv-head">
        <div className="grow sv-titles">
          <h1>{page.title}</h1>
          <div className="muted small">
            {page.table} · {page.total.toLocaleString()} record{page.total === 1 ? "" : "s"} · Read only
          </div>
        </div>
        {busy && <Spinner size={14} />}
        <label className="sv-search">
          <Icon name="search" size={14} />
          <input
            value={draft}
            placeholder="Search"
            aria-label="Search records"
            onChange={e => {
              const v = e.target.value;
              setDraft(v);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setSearch(v.trim()), 250);
            }}
            onKeyDown={e => e.key === "Escape" && (setDraft(""), setSearch(""))}
          />
        </label>
      </header>
      <div className="card sv-wrap">
        <table className="sv-table">
          <thead>
            <tr>
              {page.fields.map(f => (
                <th key={f.id} scope="col" title={f.description || f.name}>
                  <span className="sv-th">
                    <Icon name={f.type} size={13} />
                    <span>{f.name}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                {page.fields.map(f => (
                  <td key={f.id} className={"sv-td sv-" + f.type}>
                    <CellDisplay field={f} value={r.cells[f.id]} members={users} ctx={ctxFor(r.id)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="sv-empty muted">{search ? "No records match your search." : "This view has no records."}</div>}
      </div>
      {more && (
        <button type="button" className="btn" disabled={busy} onClick={() => load(search, rows.length)}>
          Load more ({(page.total - rows.length).toLocaleString()} left)
        </button>
      )}
      <a className="pf-foot" href="/" target="_blank" rel="noreferrer">
        <Logo size={14} /> Powered by Rowflare
      </a>
    </main>
  );
}
