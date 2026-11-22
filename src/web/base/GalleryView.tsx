// Gallery view: a responsive grid of record cards, rendered by visible rows only.
import { useEffect, useRef, useState } from "react";
import type { View } from "../../shared/types";
import { Button, Empty, Icon, Spinner } from "../ui";
import { type BaseClient, useBase } from "./client";
import { CARD_FIELDS, CardSettings, RecordCard, cardFields, coverField } from "./cards";
import "./views.css";

const CARD_W = 240;
const GAP = 16;

export default function GalleryView({ client, view: viewProp, search, onExpand }: { client: BaseClient; view: View; search: string; onExpand: (rowId: number) => void }) {
  useBase(client);
  const view = client.view(viewProp.id) ?? viewProp;
  const tableId = view.tableId;
  const st = client.viewState(view.id);
  const ids = st?.ids ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 600, top: 0 });
  const [settings, setSettings] = useState<HTMLElement | null>(null);

  useEffect(() => {
    client.queryView(view.id, search);
  }, [client, view.id, search]);

  // The scroller unmounts while the error or "No records" shows and comes back scrolled to the top.
  const listShown = !st?.error && !(st && !st.loading && !ids.length);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setSize(s => (s.top ? { ...s, top: 0 } : s));
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize(s => ({ ...s, w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [listShown]);

  const cover = coverField(client, view);
  const fields = cardFields(client, view);
  const cols = Math.max(1, Math.floor((size.w + GAP) / (CARD_W + GAP)));
  const cardW = (size.w - (cols - 1) * GAP) / cols;
  // Budget for the responsive 3:2 cover, excluding the card's side borders and adding the cover divider.
  const coverH = cover ? Math.ceil(Math.max(0, cardW - 2) * 2 / 3) + 1 : 0;
  const cardH = coverH + 48 + Math.min(CARD_FIELDS, fields.length) * 42;
  const rowH = cardH + GAP;
  const rowCount = Math.ceil(ids.length / cols);
  const first = Math.max(0, Math.floor(size.top / rowH) - 2);
  const last = Math.min(rowCount, Math.ceil((size.top + size.h) / rowH) + 2);
  const visible = ids.slice(first * cols, last * cols);

  useEffect(() => {
    client.ensureRows(tableId, visible);
  });

  const create = async () => {
    const rows = await client.createRows(tableId, [{}]);
    if (rows[0]) onExpand(rows[0].id);
  };

  return (
    <div className="gal">
      <div className="kb-toolbar">
        <div className="kb-toolbar-info muted small">{st?.loading && <Spinner size={14} />}</div>
        <button className={"btn btn-sm btn-ghost" + (settings ? " active" : "")} onClick={e => setSettings(settings ? null : e.currentTarget)}>
          <Icon name="settings" size={14} /> Customize cards
        </button>
        {settings && <CardSettings client={client} view={view} anchor={settings} onClose={() => setSettings(null)} />}
      </div>
      {st?.error ? (
        <Empty title="Could not load records">
          <div className="muted">{st.error}</div>
          <Button small onClick={() => client.queryView(view.id, search)}>Retry</Button>
        </Empty>
      ) : st && !st.loading && !ids.length ? (
        <Empty title="No records">{client.writable && <Button small variant="primary" icon="plus" onClick={create}>New record</Button>}</Empty>
      ) : (
        <div
          className="gal-scroll"
          ref={scroller}
          onScroll={e => {
            const top = e.currentTarget.scrollTop;
            setSize(s => ({ ...s, top }));
          }}
        >
          <div className="gal-space" style={{ height: rowCount * rowH + GAP }}>
            <div className="gal-grid" style={{ transform: `translateY(${first * rowH}px)`, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {visible.map(id => (
                <RecordCard key={id} client={client} tableId={tableId} id={id} fields={fields} cover={cover} onOpen={onExpand} style={{ height: cardH }} className={"gal-card" + (view.config.coverMode === "fit" ? " gal-card-fit" : "")} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
