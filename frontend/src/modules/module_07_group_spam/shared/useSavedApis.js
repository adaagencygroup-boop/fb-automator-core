import { useCallback, useEffect, useState } from "react";
import { getGroupSettings } from "../service";

export default function useSavedApis() {
  const [apis, setApis] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getGroupSettings();
      setApis(data.credentials || []);
      setSelectedId((current) => current === null ? (data.credential_id || "") : current);
      setError("");
    } catch (error) { setError(error.message); setApis([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    Promise.resolve().then(refresh);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  const selected = apis.find((item) => item.id === selectedId && item.configured) || null;
  return { apis, selectedId: selectedId || "", select: setSelectedId, selected, loading, error, refresh };
}
