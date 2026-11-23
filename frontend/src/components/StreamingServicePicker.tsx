import { useEffect, useId, useState } from "react";
import { api } from "../data/api";
import { createPageCache } from "../data/pageCache";
import { preferenceOptions } from "../data/preferencesCache";

const initialLimit = 8;
const servicesCache = createPageCache(async () => {
  const { items } = await api<{ items: string[] }>("/api/catalog/streaming-services");
  if (!items?.length) throw new Error("Streaming services are unavailable.");
  return items;
});

export default function StreamingServicePicker({ selected, onToggle, setup = false }: {
  selected: string[];
  onToggle: (name: string) => void;
  setup?: boolean;
}) {
  const listId = useId();
  const [items, setItems] = useState(() => servicesCache.peek() ?? preferenceOptions.streaming_services);
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void servicesCache.load().then(
      data => { if (active) setItems(data); },
      () => { if (active) setFailed(true); },
    );
    return () => { active = false; };
  }, [attempt]);

  const options = [...new Set([...items, ...selected])];
  const visible = options.filter((name, index) => expanded || index < initialLimit || selected.includes(name));

  return <>
    <div id={listId} className={setup ? "setup-choices" : "streaming-service-options"}>
      {visible.map(name => <label className={setup ? "setup-choice" : "service-check"} key={name}>
        <input type="checkbox" checked={selected.includes(name)} onChange={() => onToggle(name)} />{name}
      </label>)}
    </div>
    {items.length > initialLimit && <button type="button" className="secondary streaming-service-action" aria-controls={listId}
      aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? "See fewer services" : "See more services"}
    </button>}
    {failed && <button type="button" className="secondary streaming-service-action" onClick={() => {
      setFailed(false);
      setAttempt(value => value + 1);
    }}>Retry loading more services</button>}
  </>;
}
