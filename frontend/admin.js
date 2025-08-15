const API_URL = "https://valorant-10-mans.onrender.com";

// --- Cargar jugadores ---
async function loadPlayers() {
  try {
    const res = await fetch(`${API_URL}/players`);
    const players = await res.json();

    const tbody = document.getElementById("playersTableBody");
    tbody.innerHTML = "";
    if (players.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center">No hay jugadores registrados</td></tr>`;
      return;
    }

    players.forEach(p => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${p.name}</td>
        <td>${p.tag}</td>
        <td>${p.matchesPlayed || 0}</td>
        <td>${p.totalKills || 0}</td>
        <td>${p.totalDeaths || 0}</td>
        <td>${p.totalAssists || 0}</td>
        <td>
          <button class="editBtn">Editar</button>
          <button class="deleteBtn">Eliminar</button>
        </td>
      `;
      tbody.appendChild(row);

      // --- Editar jugador ---
      row.querySelector(".editBtn").addEventListener("click", async () => {
        const newName = prompt("Nuevo nombre:", p.name);
        const newTag = prompt("Nuevo tag:", p.tag);
        if (!newName || !newTag) return;

        try {
          // Actualizar en players
          const res1 = await fetch(`${API_URL}/players/${p._id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName, tag: newTag })
          });
          const data1 = await res1.json();
          if (!res1.ok) throw new Error(data1.error || "Error al actualizar jugador");

          // Actualizar en partidas
          const res2 = await fetch(`${API_URL}/matches/update-player`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ oldName: p.name, oldTag: p.tag, newName, newTag })
          });
          const data2 = await res2.json();
          if (!res2.ok) throw new Error(data2.error || "Error al actualizar jugador en partidas");

          alert("Jugador actualizado correctamente en jugadores y partidas");
          loadPlayers();
          loadTotalMatches();
          loadTeams();
        } catch (err) {
          alert(err.message);
        }
      });

      // --- Eliminar jugador ---
      row.querySelector(".deleteBtn").addEventListener("click", async () => {
        if (!confirm(`¿Seguro que quieres eliminar a ${p.name}? Esto no afectará las partidas existentes.`)) return;

        try {
          const res = await fetch(`${API_URL}/players/${p._id}`, { method: "DELETE" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Error al eliminar jugador");

          alert("Jugador eliminado correctamente");
          loadPlayers();
          loadTotalMatches();
          loadTeams();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    document.getElementById("totalPlayers").textContent = players.length;
  } catch (err) {
    console.error(err);
  }
}

// --- Total de partidas ---
async function loadTotalMatches() {
  try {
    const res = await fetch(`${API_URL}/matches`);
    const matches = await res.json();
    document.getElementById("totalMatches").textContent = matches.length;
  } catch (err) {
    console.error(err);
  }
}

// --- Formulario agregar jugador ---
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

    e.target.reset();
    loadPlayers();
    loadTeams();
  } catch (err) {
    alert(err.message);
  }
});

// --- Generar tablas de equipo para partidas ---
async function loadTeams() {
  const res = await fetch(`${API_URL}/players`);
  const players = await res.json();
  const teamA = document.getElementById("teamA");
  const teamB = document.getElementById("teamB");

  teamA.innerHTML = "";
  teamB.innerHTML = "";

  for (let i = 0; i < 5; i++) {
    teamA.appendChild(createPlayerRow(players));
    teamB.appendChild(createPlayerRow(players));
  }
}

function createPlayerRow(players) {
  const div = document.createElement("div");
  div.className = "player-row";

  const select = document.createElement("select");
  players.forEach(p => {
    const option = document.createElement("option");
    option.value = JSON.stringify({ name: p.name, tag: p.tag });
    option.textContent = p.name + " (" + p.tag + ")";
    select.appendChild(option);
  });

  const stats = ["kills","deaths","assists","acs","firstBloods","hsPercent"];
  stats.forEach(s => {
    const input = document.createElement("input");
    input.type = "number";
    input.placeholder = s;
    input.min = 0;
    if(s === "hsPercent") input.step = 0.1;
    div.appendChild(input);
  });

  div.prepend(select);
  return div;
}

// --- Registrar partida ---
document.getElementById("submitMatchBtn").addEventListener("click", async () => {
  const winnerTeam = document.getElementById("winnerTeam").value;
  if(!winnerTeam) return alert("Selecciona equipo ganador");

  const match = [];
  ["teamA","teamB"].forEach(id => {
    document.getElementById(id).querySelectorAll(".player-row").forEach(row => {
      const player = JSON.parse(row.querySelector("select").value);
      const stats = Array.from(row.querySelectorAll("input")).map(i => parseFloat(i.value)||0);
      match.push({
        ...player,
        kills: stats[0],
        deaths: stats[1],
        assists: stats[2],
        acs: stats[3],
        firstBloods: stats[4],
        hsPercent: stats[5]
      });
    });
  });

  try {
    const res = await fetch(`${API_URL}/matches`, {
      method:"POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ match, winnerTeam })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || "Error al registrar partida");
    alert("Partida registrada correctamente");
    loadPlayers();
    loadTotalMatches();
    loadTeams();
  } catch(err) {
    alert(err.message);
  }
});

// --- Inicialización ---
loadPlayers();
loadTotalMatches();
loadTeams();
