import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [authToken, setAuthToken] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await login(authToken);
      const from = location.state?.from?.pathname || "/";
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de connexion");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="d-flex align-items-center justify-content-center vh-100 bg-light">
      <form onSubmit={handleSubmit} className="card shadow-sm p-4" style={{ minWidth: 340 }}>
        <h1 className="h5 mb-3">Procertif — Connexion</h1>
        <label htmlFor="authToken" className="form-label small text-muted">
          Clé d'authentification
        </label>
        <input
          id="authToken"
          type="password"
          className="form-control mb-3"
          autoFocus
          value={authToken}
          onChange={(e) => setAuthToken(e.target.value)}
          autoComplete="off"
        />
        {error && <div className="text-danger small mb-3">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={pending || !authToken}>
          {pending ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
