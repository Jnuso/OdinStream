const base = (import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? "http://127.0.0.1:8000" : "")).replace(/\/$/, "");

export async function api<T>(path: string, token?: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { ...options, headers });
  } catch {
    throw new Error("Could not reach the API. Make sure the backend is running.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "The request failed. Please try again.");
  }
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}
