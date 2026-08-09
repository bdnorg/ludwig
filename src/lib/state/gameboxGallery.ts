// Lobby gallery of built-in gamebox packages (M18): fetch the index +
// each manifest's name/blurb from public/gameboxes/. The app is static-file
// hosted under a subpath on GitHub Pages, so every fetch is relative to
// Vite's BASE_URL, never root-absolute.
import { assertPortableAssets, validateGamebox, type GameboxManifest } from '../model/gamebox';

export interface GameboxGalleryEntry {
  id: string; // package dir name (public/gameboxes/<id>/)
  name: string;
  blurb?: string;
  manifest: GameboxManifest; // assets already absolutized against the package dir
}

/** Uploaded gameboxes must carry absolute asset urls (SPEC §13 / AGENTS.md
 *  M18 design call), but built-in packages ship relative ones so the whole
 *  `public/gameboxes/` tree stays relocatable. Absolutize before this
 *  manifest is ever handed to requestGamebox / downloaded. */
function absolutizeAssets(manifest: GameboxManifest, packageDirUrl: string): void {
  if (!manifest.assets) return;
  for (const [id, url] of Object.entries(manifest.assets))
    manifest.assets[id] = new URL(url, packageDirUrl).href;
}

/** Fetch `gameboxes/index.json` + every listed manifest. Best-effort: a
 *  missing index or a single bad manifest doesn't take down the gallery —
 *  it's just absent (the code templates still cover cards52/dominion/catan
 *  as a fallback while this resolves, or if it fails entirely offline). */
export async function fetchGameboxGallery(): Promise<GameboxGalleryEntry[]> {
  const base = import.meta.env.BASE_URL;
  let ids: string[];
  try {
    const res = await fetch(`${base}gameboxes/index.json`);
    if (!res.ok) return [];
    const idx = (await res.json()) as { gameboxes?: string[] };
    ids = Array.isArray(idx.gameboxes) ? idx.gameboxes : [];
  } catch {
    return [];
  }

  const entries = await Promise.all(
    ids.map(async (id): Promise<GameboxGalleryEntry | null> => {
      try {
        const dirUrl = new URL(`${base}gameboxes/${id}/`, document.baseURI).href;
        const res = await fetch(`${dirUrl}manifest.json`);
        if (!res.ok) return null;
        const manifest = validateGamebox(await res.json());
        absolutizeAssets(manifest, dirUrl);
        assertPortableAssets(manifest); // defense in depth: absolutizing must have worked
        return { id, name: manifest.name, blurb: manifest.blurb, manifest };
      } catch (err) {
        console.warn(`gamebox "${id}" failed to load`, err);
        return null;
      }
    }),
  );
  return entries.filter((e): e is GameboxGalleryEntry => e !== null);
}
