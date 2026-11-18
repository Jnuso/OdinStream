import { useState } from "react";
import { catalog, type Title } from "../data/mock";
import activeDot from "../assets/nav-active.svg";
import inactiveDot from "../assets/nav-inactive.svg";
import Modal from "./Modal";
import "./CatalogDemo.css";

type Page = "discover" | "library" | "feed" | "profile";
type Status = "watchlist" | "watching" | "watched";
type Entry = { id: number; status: Status };
const initial: Entry[] = [{ id: 2, status: "watching" }, { id: 3, status: "watching" }, { id: 5, status: "watching" }, { id: 1, status: "watchlist" }, { id: 4, status: "watchlist" }];
const colors = ["#2e4a5c", "#c8553d", "#8e6bbf", "#5b8f5b", "#3b7ca8"];

export default function CatalogDemo({ page, navigate, onNewPost }: { page: "discover" | "library"; navigate: (page: Page) => void; onNewPost: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Title | null>(null);
  const [tab, setTab] = useState<Status>("watching");
  const [entries, setEntries] = useState<Entry[]>(initial);
  const [services, setServices] = useState(["Netflix", "Max"]);
  const [notice, setNotice] = useState("");
  const filtered = catalog.filter(title => title.name.toLowerCase().includes(query.trim().toLowerCase()));
  const library = entries.filter(entry => entry.status === tab).map(entry => catalog.find(title => title.id === entry.id)).filter((title): title is Title => !!title);
  function save(id: number, status: Status) {
    setEntries(current => [...current.filter(entry => entry.id !== id), { id, status }]);
    setNotice("Updated in this demo session.");
  }
  const nav: { id: Page; label: string }[] = [{ id: "discover", label: "Discover" }, { id: "library", label: "My Library" }, { id: "feed", label: "Feed" }, { id: "profile", label: "Profile" }];
  return <div className="catalog-demo">
    <aside className="catalog-sidebar"><div className="catalog-brand"><b>O</b><strong>Odin Stream</strong></div><nav aria-label="Main navigation">{nav.map(item => <button key={item.id} className={page === item.id ? "catalog-nav active" : "catalog-nav"} aria-current={page === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><img src={page === item.id ? activeDot : inactiveDot} alt="" />{item.label}</button>)}</nav><div className="catalog-side-bottom"><button className="catalog-post" onClick={onNewPost}>+ New post</button><span className="catalog-account"><b>R</b><span>Demo account<small>United States</small></span></span></div></aside>
    <main className="catalog-main"><header className="catalog-header"><h1>{page === "discover" ? "Discover" : "My Library"}</h1>{page === "discover" && <label className="catalog-search"><span className="sr-only">Search movies and shows</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search movies and shows" /></label>}<span className="catalog-avatar" aria-label="Demo account">R</span></header>
      <p className="catalog-demo-note">Demo data · changes reset when leaving these screens</p>
      {page === "discover" ? <>
        <div className="catalog-services"><span>Your services</span>{["Netflix", "Max", "Hulu", "Disney+"].map(service => <button key={service} className={services.includes(service) ? "selected" : ""} aria-pressed={services.includes(service)} onClick={() => setServices(current => current.includes(service) ? current.filter(item => item !== service) : [...current, service])}>{service}</button>)}</div>
        <div className="catalog-section-title"><h2>{query.trim() ? "Search results" : "For you"}</h2></div>
        {filtered.length ? <div className="catalog-posters">{filtered.map((title, index) => <button className="catalog-poster-button" key={title.id} onClick={() => setSelected(title)}><span className="catalog-poster" style={{ background: colors[index % colors.length] }}>{title.name.charAt(0)}</span><strong>{title.name}</strong><small>{title.kind} · {title.year}</small></button>)}</div> : <p className="catalog-empty">No matching titles in the demo catalog.</p>}
        {!query.trim() && <><div className="catalog-section-title"><h2>Sample titles</h2></div><div className="catalog-posters trending">{catalog.map((title, index) => <button className="catalog-poster-button" key={title.id} onClick={() => setSelected(title)}><span className="catalog-poster" style={{ background: colors[(index + 1) % colors.length] }}>{title.name.charAt(0)}</span><strong>{title.name}</strong></button>)}</div></>}
      </> : <><div className="catalog-tabs" aria-label="Library status">{(["watching", "watchlist", "watched"] as Status[]).map(value => <button key={value} className={tab === value ? "selected" : ""} aria-pressed={tab === value} onClick={() => setTab(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div><div className="catalog-list">{library.length ? library.map((title, index) => <article className="catalog-row" key={title.id}><button className="catalog-row-title" onClick={() => setSelected(title)}><span className="catalog-thumb" style={{ background: colors[index % colors.length] }}>{title.name[0]}</span><span><strong>{title.name}</strong><small>{title.kind} · {title.year}</small></span></button><div className="catalog-row-actions">{tab === "watchlist" && <button onClick={() => save(title.id, title.kind === "Movie" ? "watched" : "watching")}>{title.kind === "Movie" ? "Mark watched" : "Start watching"}</button>}<button onClick={() => { setEntries(current => current.filter(entry => entry.id !== title.id)); setNotice("Removed from this demo session."); }}>Remove</button></div></article>) : <p className="catalog-empty">No titles here yet. Explore Discover to add one.</p>}</div></>}
      {notice && <p className="catalog-notice" role="status">{notice}</p>}
      {selected && <Modal label={`${selected.name} details`} onClose={() => setSelected(null)}><div className="catalog-dialog"><h2>{selected.name}</h2><p>{selected.kind} · {selected.year} · {selected.genre}</p><p>{selected.description}</p><p>Availability information is not available in this demo.</p><button className="catalog-action" onClick={() => { save(selected.id, "watchlist"); setSelected(null); }}>Add to watchlist</button></div></Modal>}
    </main>
  </div>;
}
