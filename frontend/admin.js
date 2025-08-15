const API_URL = "https://valorant-10-mans.onrender.com";

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

// --- Cargar jugadores ---
async function loadPlayers() {
  try {
    const res = await fetch(`${API_URL}/players`);
    const players = await res.json();
    const tbody = document.getElementById("playersTableBody");
    tbody.innerHTML = "";

    if (!players.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center">No hay jugadores registrados</td></tr>`;
      return;
    }

    players.forEach(p => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td><input type="text" value="${p.name}" class="edit-name"></td>
        <td><input type="text" value="${p.tag}" class="edit-tag"></td>
        <td>${p.matchesPlayed || 0}</td>
        <td>${p.totalKills || 0}</td>
        <td>${p.totalDeaths || 0}</td>
        <td>${p.totalAssists || 0}</td>
        <td>
          <button class="btn-update">Guardar</button>
          <button class="btn-delete">Eliminar</button>
        </td>
      `;
      tbody.appendChild(row);

      // Guardar cambios
      row.querySelector(".btn-update").addEventListener("click", async () => {
        const newName = row.querySelector(".edit-name").value.trim();
        const newTag = row.querySelector(".edit-tag").value.trim();
        if (!newName || !newTag) return alert("Nombre y tag requeridos");

        try {
          const res = await fetch(`${API_URL}/players`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ oldName: p.name, oldTag: p.tag, newName, newTag })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Error al actualizar jugador");
          alert(data.message);
          loadPlayers();
        } catch (err) {
          alert(err.message);
        }
      });

      // Eliminar jugador
      row.querySelector(".btn-delete").addEventListener("click", async () => {
        if (!confirm("¿Eliminar jugador? Esto también lo quitará de todas las partidas")) return;

        try {
          const res = await fetch(`${API_URL}/players`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: p.name, tag: p.tag })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Error al eliminar jugador");
          alert(data.message);
          loadPlayers();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    // Actualizar totalPlayers y totalMatches
    document.getElementById("totalPlayers").innerText = players.length;

    // Total matches
    const matchesRes = await fetch(`${API_URL}/matches`);
    const matchesData = await matchesRes.json();
    document.getElementById("totalMatches").innerText = matchesData.length || 0;

  } catch (err) {
    console.error(err);
  }
}

// --- Cargar jugadores al iniciar ---
loadPlayers();
