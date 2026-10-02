// Tablemap: seats guests so groups stay together, feuds stay apart and accessibility needs are met.
import { useState } from "react";
import { download, uid, useStored } from "./lib/store";

type Guest = { id: string; name: string; group: string; aisle: boolean };
type Rule = { id: string; a: string; b: string; kind: "together" | "apart" };
type Seating = Record<string, number>; // guest id -> table index (0-based), -1 = unseated

const T = "tablemap";
const SAMPLE_TEXT = `Amira Ben Ali, Bride's family
Karim Ben Ali, Bride's family
Nour Ben Ali, Bride's family
Grandma Zohra, Bride's family, aisle
Youssef Trabelsi, Groom's family
Salma Trabelsi, Groom's family
Omar Trabelsi, Groom's family
Uncle Hedi, Groom's family, aisle
Ines, University friends
Mehdi, University friends
Rania, University friends
Walid, University friends
Sarra, Work
Firas, Work
Dora, Work
Aziz, Work
Lina, Neighbours
Hamza, Neighbours`;

function parse(text: string): Guest[] {
  return text.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const [name, group = "Guests", flag = ""] = l.split(",").map(s => s.trim());
    return { id: uid(), name, group: group || "Guests", aisle: /aisle|wheel|access/i.test(flag) };
  });
}
const SAMPLE_GUESTS = parse(SAMPLE_TEXT);

/** Score a seating: reward shared groups, enforce rules. Higher is better. */
function score(seat: Seating, guests: Guest[], rules: Rule[], aisleTables: number) {
  let s = 0;
  const byTable = new Map<number, Guest[]>();
  guests.forEach(g => { const t = seat[g.id]; if (t >= 0) { if (!byTable.has(t)) byTable.set(t, []); byTable.get(t)!.push(g); } else s -= 50; });
  byTable.forEach(list => {
    const counts = new Map<string, number>();
    list.forEach(g => counts.set(g.group, (counts.get(g.group) || 0) + 1));
    counts.forEach(n => (s += n * (n - 1)));
  });
  rules.forEach(r => {
    const ta = seat[r.a], tb = seat[r.b];
    if (ta === undefined || tb === undefined) return;
    if (r.kind === "together") s += ta === tb ? 30 : -100;
    else s += ta === tb ? -200 : 0;
  });
  guests.forEach(g => { if (g.aisle && seat[g.id] >= aisleTables) s -= 150; });
  return s;
}

function autoSeat(guests: Guest[], rules: Rule[], tables: number, seats: number, aisleTables: number): Seating {
  // Start by filling tables group by group (aisle guests first), then improve with random swaps and moves.
  const order = [...guests].sort((a, b) => Number(b.aisle) - Number(a.aisle) || a.group.localeCompare(b.group));
  const seat: Seating = {};
  const load = Array(tables).fill(0);
  order.forEach(g => {
    let t = load.findIndex(n => n < seats);
    if (g.aisle) { const a = load.findIndex((n, i) => i < aisleTables && n < seats); if (a >= 0) t = a; }
    seat[g.id] = t; if (t >= 0) load[t]++;
  });
  let best = { ...seat }, bestScore = score(best, guests, rules, aisleTables);
  const ids = guests.map(g => g.id);
  for (let iter = 0; iter < 6000 && ids.length > 1; iter++) {
    const cur = { ...best };
    const a = ids[Math.floor(Math.random() * ids.length)];
    if (Math.random() < 0.7) {
      const b = ids[Math.floor(Math.random() * ids.length)];
      [cur[a], cur[b]] = [cur[b], cur[a]];
    } else {
      const t = Math.floor(Math.random() * tables);
      if (ids.filter(id => cur[id] === t).length >= seats) continue;
      cur[a] = t;
    }
    const sc = score(cur, guests, rules, aisleTables);
    if (sc >= bestScore) { best = cur; bestScore = sc; }
  }
  return best;
}

export default function Tablemap() {
  const [guests, setGuests] = useStored<Guest[]>(T, "guests", SAMPLE_GUESTS);
  const [rules, setRules] = useStored<Rule[]>(T, "rules", [
    { id: "r1", a: SAMPLE_GUESTS[6].id, b: SAMPLE_GUESTS[7].id, kind: "apart" },
    { id: "r2", a: SAMPLE_GUESTS[8].id, b: SAMPLE_GUESTS[16].id, kind: "together" },
  ]);
  const [tables, setTables] = useStored(T, "tables", 3);
  const [seats, setSeats] = useStored(T, "seats", 8);
  const [aisleTables, setAisleTables] = useStored(T, "aisle", 1);
  const [seating, setSeating] = useStored<Seating>(T, "seating", {});
  const [names, setNames] = useStored<string[]>(T, "tableNames", []);
  const [paste, setPaste] = useState("");
  const [ruleDraft, setRuleDraft] = useState({ a: "", b: "", kind: "apart" as Rule["kind"] });

  const tableName = (i: number) => names[i] || `Table ${i + 1}`;
  const nameOf = (id: string) => guests.find(g => g.id === id)?.name ?? "Removed guest";
  const capacity = tables * seats;
  const seatOf = (id: string) => { const t = seating[id] ?? -1; return t < tables ? t : -1; };

  const problems: string[] = [];
  rules.forEach(r => {
    const ta = seatOf(r.a), tb = seatOf(r.b);
    if (ta < 0 || tb < 0) return;
    if (r.kind === "apart" && ta === tb) problems.push(`${nameOf(r.a)} and ${nameOf(r.b)} are at the same table.`);
    if (r.kind === "together" && ta !== tb) problems.push(`${nameOf(r.a)} and ${nameOf(r.b)} are at different tables.`);
  });
  guests.forEach(g => { const t = seatOf(g.id); if (g.aisle && t >= aisleTables) problems.push(`${g.name} needs an aisle table.`); });
  for (let t = 0; t < tables; t++) { const n = guests.filter(g => seatOf(g.id) === t).length; if (n > seats) problems.push(`${tableName(t)} has ${n} guests for ${seats} seats.`); }

  const unseated = guests.filter(g => seatOf(g.id) < 0);
  const hasPlan = guests.some(g => seatOf(g.id) >= 0);
  const run = () => setSeating(autoSeat(guests, rules, tables, seats, Math.min(aisleTables, tables)));

  const addPasted = () => { const list = parse(paste); if (list.length) { setGuests([...guests, ...list]); setPaste(""); } };
  const exportCsv = () => {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const rows = ["Table,Guest,Group"];
    for (let t = 0; t < tables; t++) guests.filter(g => seatOf(g.id) === t).forEach(g => rows.push([tableName(t), g.name, g.group].map(q).join(",")));
    unseated.forEach(g => rows.push(["Not seated", g.name, g.group].map(q).join(",")));
    download("seating-plan.csv", rows.join("\n"), "text/csv");
  };

  const groups = Array.from(new Set(guests.map(g => g.group)));
  const hue = (group: string) => ["#3255A4", "#FF48B0", "#00838A", "#FF6C2F", "#765BA7", "#00A95C", "#C0343F", "#A26500"][groups.indexOf(group) % 8];
  const tableOptions = Array.from({ length: tables }, (_, k) => <option key={k} value={k}>{tableName(k)}</option>);

  return (
    <div className="stack">
      <div className="grid2">
        <section className="panel">
          <h2>Guests <span className="pill num">{guests.length}</span></h2>
          <label className="field"><span>Paste guests, one per line: Name, Group, aisle</span>
            <textarea id="tm-paste" className="input" value={paste} onChange={e => setPaste(e.target.value)} placeholder={"Leila Mansour, Bride's family\nGrandpa Ali, Groom's family, aisle"} />
          </label>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn small" onClick={addPasted} disabled={!paste.trim()}>Add guests</button>
            <button className="btn ghost small danger" onClick={() => { setGuests([]); setRules([]); setSeating({}); }}>Remove everyone</button>
          </div>
          <div className="tm-guests">
            {guests.map(g => (
              <div key={g.id} className="tm-guest">
                <i style={{ background: hue(g.group) }} />
                <span>{g.name}</span>
                <span className="note">{g.group}</span>
                <label className="check note" title="Needs an aisle or accessible table"><input id={`tm-a-${g.id}`} type="checkbox" checked={g.aisle} onChange={e => setGuests(guests.map(x => x.id === g.id ? { ...x, aisle: e.target.checked } : x))} />Aisle</label>
                <button className="btn ghost small danger" aria-label={`Remove ${g.name}`} onClick={() => setGuests(guests.filter(x => x.id !== g.id))}>Remove</button>
              </div>
            ))}
          </div>
        </section>

        <div className="stack">
          <section className="panel">
            <h2>Room</h2>
            <div className="row">
              <label className="field"><span>Tables</span><input id="tm-tables" type="number" min={1} max={60} className="input num" value={tables} onChange={e => setTables(Math.max(1, Math.min(60, +e.target.value || 1)))} /></label>
              <label className="field"><span>Seats per table</span><input id="tm-seats" type="number" min={2} max={20} className="input num" value={seats} onChange={e => setSeats(Math.max(2, Math.min(20, +e.target.value || 2)))} /></label>
              <label className="field"><span>Tables by the aisle</span><input id="tm-aisle" type="number" min={0} max={tables} className="input num" value={aisleTables} onChange={e => setAisleTables(Math.max(0, Math.min(tables, +e.target.value || 0)))} /></label>
            </div>
            <p className="note" style={{ marginTop: 10 }}>{capacity} seats for {guests.length} guests. {capacity < guests.length ? <strong style={{ color: "var(--bad)" }}>Add {Math.ceil((guests.length - capacity) / seats)} more tables.</strong> : `${capacity - guests.length} spare.`}</p>
          </section>

          <section className="panel">
            <h2>Rules</h2>
            <div className="row">
              <label className="field"><span>Guest</span><select id="tm-ra" className="input" value={ruleDraft.a} onChange={e => setRuleDraft({ ...ruleDraft, a: e.target.value })}><option value="">Choose</option>{guests.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
              <label className="field" style={{ flexBasis: 120 }}><span>Must sit</span><select id="tm-rk" className="input" value={ruleDraft.kind} onChange={e => setRuleDraft({ ...ruleDraft, kind: e.target.value as Rule["kind"] })}><option value="apart">apart from</option><option value="together">with</option></select></label>
              <label className="field"><span>Guest</span><select id="tm-rb" className="input" value={ruleDraft.b} onChange={e => setRuleDraft({ ...ruleDraft, b: e.target.value })}><option value="">Choose</option>{guests.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
              <button className="btn small" disabled={!ruleDraft.a || !ruleDraft.b || ruleDraft.a === ruleDraft.b} onClick={() => { setRules([...rules, { id: uid(), ...ruleDraft }]); setRuleDraft({ a: "", b: "", kind: ruleDraft.kind }); }}>Add rule</button>
            </div>
            <div className="stack" style={{ gap: 6, marginTop: 12 }}>
              {rules.length === 0 && <p className="note">No rules yet. Add who must sit together or apart.</p>}
              {rules.map(r => (
                <div key={r.id} className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                  <span><strong>{nameOf(r.a)}</strong> <span className={"pill " + (r.kind === "apart" ? "bad" : "good")}>{r.kind === "apart" ? "apart from" : "with"}</span> <strong>{nameOf(r.b)}</strong></span>
                  <button className="btn ghost small danger" onClick={() => setRules(rules.filter(x => x.id !== r.id))}>Remove</button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="panel">
        <div className="row no-print" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Seating plan</h2>
          <div className="row">
            <button className="btn primary" onClick={run} disabled={!guests.length}>{hasPlan ? "Seat everyone again" : "Seat everyone"}</button>
            <button className="btn small" onClick={exportCsv}>Export CSV</button>
            <button className="btn small" onClick={() => window.print()}>Print</button>
          </div>
        </div>
        {!hasPlan ? (
          <p className="empty-note no-print" style={{ marginBottom: 16 }}>Press “Seat everyone” to get a first plan. Then move anyone by hand.</p>
        ) : problems.length > 0 ? (
          <div className="stack no-print" style={{ gap: 6, marginBottom: 16 }}>{problems.map((p, i) => <span key={i} className="pill bad" style={{ alignSelf: "flex-start" }}>{p}</span>)}</div>
        ) : <p className="no-print" style={{ marginBottom: 16 }}><span className="pill good">Every rule is met</span></p>}

        <div className="tm-tables">
          {Array.from({ length: tables }, (_, t) => {
            const list = guests.filter(g => seatOf(g.id) === t);
            const chairs = Math.max(seats, list.length);
            return (
              <div key={t} className="tm-table">
                <div className="tm-round">
                  {Array.from({ length: chairs }, (_, k) => {
                    const g = list[k];
                    const ang = (k / chairs) * 360 - 90;
                    return <span key={k} className={"tm-chair" + (g ? " on" : "")} style={{ transform: `rotate(${ang}deg) translate(62px) rotate(${-ang}deg)`, background: g ? hue(g.group) : undefined }} title={g?.name} />;
                  })}
                  <input id={`tm-name-${t}`} className="tm-tname" value={tableName(t)} aria-label={`Name of table ${t + 1}`} onChange={e => { const n = [...names]; n[t] = e.target.value; setNames(n); }} />
                  {t < aisleTables && <span className="tm-aisle">Aisle</span>}
                </div>
                <ol>
                  {list.map(g => (
                    <li key={g.id}>
                      <span>{g.name}</span>
                      <select className="tm-move no-print" aria-label={`Move ${g.name}`} value={t} onChange={e => setSeating({ ...seating, [g.id]: +e.target.value })}>
                        {tableOptions}<option value={-1}>Not seated</option>
                      </select>
                    </li>
                  ))}
                  {list.length === 0 && <li className="note">Empty</li>}
                </ol>
              </div>
            );
          })}
        </div>
        {unseated.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <p className="eyebrow" style={{ marginBottom: 8 }}>Not seated yet · {unseated.length}</p>
            <div className="row">{unseated.map(g => (
              <label key={g.id} className="pill" style={{ gap: 8 }}>{g.name}
                <select className="tm-move" aria-label={`Seat ${g.name}`} value={-1} onChange={e => setSeating({ ...seating, [g.id]: +e.target.value })}>
                  <option value={-1}>Choose table</option>{tableOptions}
                </select>
              </label>
            ))}</div>
          </div>
        )}
        <div className="row no-print" style={{ marginTop: 18, gap: 14 }}>{groups.map(g => <span key={g} className="note" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><i style={{ width: 10, height: 10, borderRadius: 5, background: hue(g), display: "inline-block" }} />{g}</span>)}</div>
      </section>
      <style>{`
        .tm-guests{margin-top:16px;max-height:380px;overflow:auto;border-top:1px solid var(--line)}
        .tm-guest{display:grid;grid-template-columns:10px 1fr auto auto auto;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)}
        .tm-guest i{width:10px;height:10px;border-radius:5px}
        .tm-tables{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px}
        .tm-table{border:1px solid var(--line);border-radius:12px;padding:16px;break-inside:avoid}
        .tm-round{position:relative;width:160px;height:160px;margin:0 auto 12px;display:grid;place-items:center}
        .tm-round::before{content:"";position:absolute;inset:34px;border-radius:50%;background:var(--sunk);border:1px solid var(--line)}
        .tm-chair{position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px;border-radius:50%;border:2px solid var(--line);background:var(--surface)}
        .tm-chair.on{border-color:transparent}
        .tm-tname{position:relative;width:84px;text-align:center;border:0;background:transparent;font-family:var(--serif);font-size:17px;color:var(--ink)}
        .tm-aisle{position:absolute;bottom:4px;font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
        .tm-table ol{margin:0;padding-left:20px;display:grid;gap:4px;font-size:14px}
        .tm-table li{display:flex;justify-content:space-between;gap:6px;align-items:center}
        .tm-move{border:1px solid var(--line);background:var(--surface);border-radius:6px;font-size:12px;padding:2px 4px;max-width:110px}
        @media (max-width:480px){.tm-guest{grid-template-columns:10px 1fr auto;}.tm-guest .note:not(.check){display:none}}
      `}</style>
    </div>
  );
}
