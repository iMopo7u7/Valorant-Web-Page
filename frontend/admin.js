// Cambia esto por tu backend en Render
const API_URL = "https://valorant-10-mans-frontend.onrender.com";

// --- Añadir jugador ---
document.getElementById("addPlayerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("playerName").value.trim();
    const tag = document.getElementById("playerTag").value.trim();

    if (!name || !tag) return alert("Nombre y tag son requeridos");

    try {
        const res = await fetch(`${API_URL}/players`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, tag })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al añadir jugador");

        alert(data.message);
        e.target.reset();
        loadPlayers();
    } catch (err) {
        alert(err.message);
    }
});

// --- Cargar jugadores para la tabla ---
async function loadPlayers() {
    try {
        const res = await fetch(`${API_URL}/players`);
        const players = await res.json();

        const tbody = document.getElementById("playersTableBody");
        tbody.innerHTML = "";

        players.forEach(p => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${p.name}</td>
                <td>${p.tag}</td>
                <td>${p.matchesPlayed || 0}</td>
                <td>${p.totalKills || 0}</td>
                <td>${p.totalDeaths || 0}</td>
                <td>${p.totalAssists || 0}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (err) {
        console.error("Error cargando jugadores:", err);
    }
}

// --- Añadir partida ---
document.getElementById("addMatchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
        const matchData = JSON.parse(document.getElementById("matchData").value);
        const winnerTeam = document.getElementById("winnerTeam").value;

        const res = await fetch(`${API_URL}/matches`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ match: matchData, winnerTeam })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al añadir partida");

        alert(data.message);
        e.target.reset();
        loadPlayers();
    } catch (err) {
        alert("Error: " + err.message);
    }
});

// Cargar jugadores al iniciar
loadPlayers();
