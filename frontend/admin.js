// admin.js
document.addEventListener("DOMContentLoaded", () => {
    const playersTableBody = document.querySelector("#playersTable tbody");
    const addPlayerForm = document.getElementById("addPlayerForm");
    const addMatchForm = document.getElementById("addMatchForm");
    const logoutBtn = document.getElementById("logoutBtn");

    // 📌 Cargar jugadores
    async function loadPlayers() {
        try {
            const res = await fetch("/players");
            if (!res.ok) throw new Error("Error al cargar jugadores");
            const players = await res.json();

            playersTableBody.innerHTML = "";
            players.forEach(p => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${p.name}</td>
                    <td>${p.tag}</td>
                    <td>${p.matchesPlayed || 0}</td>
                    <td>${p.wins || 0}</td>
                `;
                playersTableBody.appendChild(tr);
            });
        } catch (err) {
            alert(err.message);
        }
    }

    // 📌 Añadir jugador
    addPlayerForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = document.getElementById("playerName").value.trim();
        const tag = document.getElementById("playerTag").value.trim();

        try {
            const res = await fetch("/players", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, tag })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Error al añadir jugador");
            alert(data.message);
            addPlayerForm.reset();
            loadPlayers();
        } catch (err) {
            alert(err.message);
        }
    });

    // 📌 Añadir partida
    addMatchForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            const matchData = [];
            for (let i = 1; i <= 10; i++) {
                matchData.push({
                    name: document.getElementById(`name${i}`).value.trim(),
                    tag: document.getElementById(`tag${i}`).value.trim(),
                    kills: Number(document.getElementById(`kills${i}`).value),
                    deaths: Number(document.getElementById(`deaths${i}`).value),
                    assists: Number(document.getElementById(`assists${i}`).value),
                    acs: Number(document.getElementById(`acs${i}`).value),
                    firstBloods: Number(document.getElementById(`firstBloods${i}`).value),
                    hsPercent: Number(document.getElementById(`hsPercent${i}`).value)
                });
            }

            const winnerTeam = document.querySelector("input[name='winnerTeam']:checked").value;

            const res = await fetch("/matches", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ match: matchData, winnerTeam })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Error al añadir partida");
            alert(data.message);
            addMatchForm.reset();
            loadPlayers();
        } catch (err) {
            alert(err.message);
        }
    });

    // 📌 Logout
    logoutBtn.addEventListener("click", async () => {
        await fetch("/api/logout");
        window.location.href = "/login.html";
    });

    // 📌 Inicializar
    loadPlayers();
});
