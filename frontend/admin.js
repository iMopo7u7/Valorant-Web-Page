const API_URL = "https://valorant-10-mans.onrender.com";

const addPlayerForm = document.getElementById("addPlayerForm");
const addMatchForm = document.getElementById("addMatchForm");
const playersRows = document.getElementById("playersRows");

// Carga los jugadores para dropdown y genera filas del formulario de partida
async function loadPlayers() {
  try {
    const res = await fetch(`${API_URL}/players`);
    const players = await res.json();

    if (players.length < 10) {
      playersRows.innerHTML = `<tr><td colspan="8" style="color:#ff4655;">Necesitas al menos 10 jugadores registrados para añadir partidas.</td></tr>`;
      return;
    }

    // Generar select para jugadores (sin repetir)
    // Dividimos en 5 filas para Team A y 5 para Team B

    let html = "";
    for (let i = 0; i < 10; i++) {
      const teamClass = i < 5 ? "teamA" : "teamB";
      const teamName = i < 5 ? "Team A" : "Team B";

      html += `<tr class="${teamClass}">
        <td>${i + 1}</td>
        <td>${teamName}</td>
        <td>
          <select class="player-select" required>
            <option value="">-- Selecciona jugador --</option>
            ${players
              .map(
                (p) =>
                  `<option value="${p.name}#${p.tag}">${p.name}#${p.tag}</option>`
              )
              .join("")}
          </select>
        </td>
        <td><input type="number" class="kills-input" min="0" required /></td>
        <td><input type="number" class="deaths-input" min="0" required /></td>
        <td><input type="number" class="assists-input" min="0" required /></td>
        <td><input type="number" class="acs-input" min="0" required /></td>
        <td><input type="number" class="fb-input" min="0" required /></td>
      </tr>`;
    }
    playersRows.innerHTML = html;

    // Añadir control para evitar seleccionar jugadores repetidos
    const selects = document.querySelectorAll(".player-select");
    selects.forEach((select) =>
      select.addEventListener("change", () => {
        const selectedValues = Array.from(selects)
          .map((s) => s.value)
          .filter((v) => v !== "");
        selects.forEach((s) => {
          if (s.value === "") {
            // disable opciones que ya fueron seleccionadas en otro select
            Array.from(s.options).forEach((opt) => {
              opt.disabled = selectedValues.includes(opt.value);
            });
          }
        });
      })
    );
  } catch (err) {
    playersRows.innerHTML = `<tr><td colspan="8" style="color:#ff4655;">Error cargando jugadores</td></tr>`;
  }
}

// Añadir jugador
addPlayerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = e.target.playerName.value.trim();
  const tag = e.target.playerTag.value.trim();

  if (!name || !tag) {
    alert("Por favor ingresa nombre y tag válidos.");
    return;
  }

  try {
    const res = await fetch(`${API_URL}/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, tag }),
    });
    const data = await res.json();
    alert(data.message || data.error);
    if (!data.error) {
      addPlayerForm.reset();
      await loadPlayers();
    }
  } catch {
    alert("Error al conectar con el servidor");
  }
});

// Registrar partida
addMatchForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const rows = document.querySelectorAll("#playersRows tr");

  if (rows.length !== 10) {
    alert("Debe haber exactamente 10 jugadores.");
    return;
  }

  const matchData = [];
  const usedPlayers = new Set();

  for (const row of rows) {
    const select = row.querySelector(".player-select");
    const playerValue = select.value;
    if (!playerValue) {
      alert("Selecciona todos los jugadores.");
      return;
    }
    if (usedPlayers.has(playerValue)) {
      alert("No puedes repetir jugadores en la misma partida.");
      return;
    }
    usedPlayers.add(playerValue);

    const [name, tag] = playerValue.split("#");
    const kills = Number(row.querySelector(".kills-input").value);
    const deaths = Number(row.querySelector(".deaths-input").value);
    const assists = Number(row.querySelector(".assists-input").value);
    const acs = Number(row.querySelector(".acs-input").value);
    const firstBloods = Number(row.querySelector(".fb-input").value);

    if (
      [kills, deaths, assists, acs, firstBloods].some(
        (v) => isNaN(v) || v < 0
      )
    ) {
      alert("Completa todos los campos numéricos correctamente.");
      return;
    }

    matchData.push({
      name,
      tag,
      kills,
      deaths,
      assists,
      kda: deaths === 0 ? kills + assists : (kills + assists) / deaths,
      acs,
      firstBloods,
    });
  }

  try {
    const res = await fetch(`${API_URL}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ match: matchData }),
    });
    const data = await res.json();
    alert(data.message || data.error);
    if (!data.error) {
      addMatchForm.reset();
      await loadPlayers();
    }
  } catch {
    alert("Error al conectar con el servidor");
  }
});

// Al cargar la página
loadPlayers();
