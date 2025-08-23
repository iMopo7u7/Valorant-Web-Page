const API_URL = window.location.origin;

// --- Verificar sesión ---
(async ()=>{
  try {
    const res = await fetch('/check-session',{credentials:'include'});
    const data = await res.json();
    if(!data.loggedIn) window.location.href='/login.html';
  } catch { window.location.href='/login.html'; }
})();

// --- Navegación ---
const navLinks = document.querySelectorAll('nav a');
const sections = document.querySelectorAll('section');
navLinks.forEach(link=>{
  link.addEventListener('click', e=>{
    e.preventDefault();
    navLinks.forEach(l=>l.classList.remove('active'));
    link.classList.add('active');
    sections.forEach(s=>s.style.display='none');
    document.querySelector(link.getAttribute('href')).style.display='block';
  });
});
sections[0].style.display='block';

// --- Logout ---
document.getElementById('logoutBtn').addEventListener('click', async ()=>{
  await fetch('/logout',{method:'POST',credentials:'include'});
  window.location.href='/login.html';
});

// --- CRUD Jugadores ---
let allPlayers=[];
async function loadPlayers(){
  try{
    const res = await fetch('/players',{credentials:'include'});
    allPlayers = await res.json();
    updatePlayersTable();
    populateTeams();
    updateDashboard();
  }catch(err){console.error(err);}
}

function updatePlayersTable(){
  const tbody = document.getElementById('playersTableBody');
  tbody.innerHTML='';
  if(!allPlayers.length){
    tbody.innerHTML='<tr><td colspan="7">No hay jugadores registrados</td></tr>';
    return;
  }
  allPlayers.forEach(p=>{
    const row=document.createElement('tr');
    row.innerHTML=`
      <td>${p.name}</td>
      <td>${p.tag}</td>
      <td>${p.matchesPlayed||0}</td>
      <td>${p.totalKills||0}</td>
      <td>${p.totalDeaths||0}</td>
      <td>${p.totalAssists||0}</td>
      <td>
        <button class="btn-edit">Editar</button>
        <button class="btn-delete">Eliminar</button>
      </td>`;
    tbody.appendChild(row);

    // Editar y eliminar
    const editBtn = row.querySelector('.btn-edit');
    const deleteBtn = row.querySelector('.btn-delete');
    const editForm = document.createElement('tr');
    editForm.className='edit-form-row';
    editForm.innerHTML=`<td colspan="7">
      <div class="edit-form" style="display:none;">
        <input type="text" class="edit-name" value="${p.name}" placeholder="Nombre">
        <input type="text" class="edit-tag" value="${p.tag}" placeholder="Tag">
        <input type="text" class="edit-twitter" value="${p.social?.twitter||''}" placeholder="Twitter">
        <input type="text" class="edit-tracker" value="${p.social?.tracker||''}" placeholder="Valorant Tracker">
        <input type="text" class="edit-twitch" value="${p.social?.twitch||''}" placeholder="Twitch">
        <button class="btn-save">Guardar</button>
        <button class="btn-cancel">Cancelar</button>
      </div>
    </td>`;
    row.parentNode.insertBefore(editForm, row.nextSibling);

    const formDiv = editForm.querySelector('.edit-form');
    editBtn.addEventListener('click', ()=> formDiv.style.display = 'block');
    formDiv.querySelector('.btn-cancel').addEventListener('click', ()=> formDiv.style.display = 'none');
    formDiv.querySelector('.btn-save').addEventListener('click', async ()=>{
      const newName = formDiv.querySelector('.edit-name').value.trim();
      const newTag = formDiv.querySelector('.edit-tag').value.trim();
      const twitter = formDiv.querySelector('.edit-twitter').value.trim();
      const tracker = formDiv.querySelector('.edit-tracker').value.trim();
      const twitch = formDiv.querySelector('.edit-twitch').value.trim();
      if(!newName||!newTag) return alert('Nombre y tag requeridos');
      try{
        const res = await fetch('/players',{
          method:'PUT',
          headers:{'Content-Type':'application/json'},
          credentials:'include',
          body:JSON.stringify({
            oldName:p.name,
            oldTag:p.tag,
            newName,
            newTag,
            social:{twitter, tracker, twitch}
          })
        });
        const data = await res.json();
        if(!res.ok) throw new Error(data.error||'Error al actualizar');
        alert(data.message); loadPlayers();
      }catch(err){alert(err.message);}
    });

    deleteBtn.addEventListener('click', async ()=>{
      if(!confirm('¿Eliminar jugador?')) return;
      try{
        const res = await fetch('/players',{
          method:'DELETE',
          headers:{'Content-Type':'application/json'},
          credentials:'include',
          body:JSON.stringify({name:p.name, tag:p.tag})
        });
        const data = await res.json();
        if(!res.ok) throw new Error(data.error||'Error al eliminar jugador');
        alert(data.message); loadPlayers();
      }catch(err){alert(err.message);}
    });
  });
}

// --- DASHBOARD ---
async function updateDashboard(){
  document.getElementById('totalPlayers').innerText = allPlayers.length;
  try{
    const resMatches = await fetch('/matches-count',{credentials:'include'});
    const dataMatches = await resMatches.json();
    document.getElementById('totalMatches').innerText = dataMatches.count||0;
    const resLast = await fetch('/last-match',{credentials:'include'});
    const last = await resLast.json();
    document.getElementById('lastMatchDate').innerText = last.date ? new Date(last.date).toLocaleString() : 'N/A';
  }catch{ document.getElementById('totalMatches').innerText = 0; }
}

// --- TEAMS ---
function populateTeams(){
  const teamA = document.getElementById('teamA');
  const teamB = document.getElementById('teamB');
  teamA.innerHTML=''; teamB.innerHTML='';

  const createRow=()=> {
    const row=document.createElement('div');
    row.className='form-inline';
    row.innerHTML=`
      <select class="player-select"><option value="">-- Selecciona jugador --</option>${allPlayers.map(p=>`<option value="${p.name}||${p.tag}">${p.name} (${p.tag})</option>`).join('')}</select>
      <input type="number" placeholder="ACS" class="acs" min="0">
      <input type="number" placeholder="Kills" class="kill" min="0">
      <input type="number" placeholder="Deaths" class="death" min="0">
      <input type="number" placeholder="Assists" class="assist" min="0">
      <input type="number" placeholder="HS%" class="hs" min="0" max="100">
      <input type="number" placeholder="FirstBloods" class="fb" min="0">`;
    return row;
  };
  for(let i=0;i<5;i++){ teamA.appendChild(createRow()); teamB.appendChild(createRow()); }
}

// --- REGISTRAR PARTIDA ---
document.getElementById('submitMatchBtn').addEventListener('click', async ()=>{
  const map = document.getElementById('matchMap').value;
  const winnerTeam = document.getElementById('winnerTeam').value;
  const score = document.getElementById('matchScore').value.trim();
  if(!map) return alert('Selecciona mapa');
  if(!winnerTeam) return alert('Selecciona ganador');
  if(!score) return alert('Ingresa marcador final');

  const match=[];
  const teamA = document.getElementById('teamA').querySelectorAll('.form-inline');
  const teamB = document.getElementById('teamB').querySelectorAll('.form-inline');
  for(const row of [...teamA,...teamB]){
    const select=row.querySelector('.player-select'); if(!select.value) continue;
    const [name, tag] = select.value.split('||');
    const acs = parseInt(row.querySelector('.acs').value)||0;
    const kills = parseInt(row.querySelector('.kill').value)||0;
    const deaths = parseInt(row.querySelector('.death').value)||0;
    const assists = parseInt(row.querySelector('.assist').value)||0;
    const hsPercent = parseFloat(row.querySelector('.hs').value)||0;
    const firstBloods = parseInt(row.querySelector('.fb').value)||0;
    match.push({name,tag,acs,kills,deaths,assists,hsPercent,firstBloods});
  }
  if(match.length===0) return alert('No hay jugadores seleccionados');

  try{
    const res = await fetch('/matches',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'include',
      body:JSON.stringify({match,winnerTeam,score,map})
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error||'Error al registrar partida');
    alert(data.message); loadPlayers(); loadMatches();
  }catch(err){alert(err.message);}
});

// --- CARGAR Y EDITAR PARTIDAS ---
async function loadMatches(){
  try{
    const res = await fetch('/matches',{credentials:'include'});
    const matches = await res.json();
    const tbody = document.getElementById('matchesTableBody');
    tbody.innerHTML='';
    if(!matches.length){
      tbody.innerHTML='<tr><td colspan="5">No hay partidas registradas</td></tr>';
      return;
    }
    matches.forEach(m=>{
      const row = document.createElement('tr');
      row.innerHTML=`
        <td>${m.map}</td>
        <td>${m.score}</td>
        <td>${m.winnerTeam}</td>
        <td>${new Date(m.date).toLocaleString()}</td>
        <td><button class="btn-edit-match">Editar</button></td>`;
      tbody.appendChild(row);
      const editBtn = row.querySelector('.btn-edit-match');
      editBtn.addEventListener('click', ()=>{ /* editar partida (igual que antes) */ });
    });
  }catch(err){console.error(err);}
}

// --- EVENTOS / TORNEOS ---
let allEvents=[];
const createEventBtn = document.getElementById('createEventBtn');
const eventsTableBody = document.getElementById('eventsTableBody');
const eventMatchesPanel = document.getElementById('eventMatchesPanel');
const eventMatchesTitle = document.getElementById('eventMatchesTitle');
const eventMatchesList = document.getElementById('eventMatchesList');
const closeEventMatches = document.getElementById('closeEventMatches');

async function loadEvents(){
  try{
    const res = await fetch('/events',{credentials:'include'});
    allEvents = await res.json();
    renderEvents();
  }catch(err){console.error(err);}
}

function renderEvents(){
  if(!allEvents.length){
    eventsTableBody.innerHTML='<tr><td colspan="5">No hay eventos creados</td></tr>';
    return;
  }
  eventsTableBody.innerHTML='';
  allEvents.forEach((ev,i)=>{
    const row=document.createElement('tr');
    row.innerHTML=`
      <td>${ev.name}</td>
      <td>${ev.teamSize}vs${ev.teamSize}</td>
      <td>${ev.numTeams}</td>
      <td>${ev.rounds||0}</td>
      <td><button class="btn-view" data-index="${i}">Ver / Editar</button></td>`;
    eventsTableBody.appendChild(row);
  });

  document.querySelectorAll('.btn-view').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const ev = allEvents[btn.dataset.index];
      eventMatchesTitle.innerText = `Partidas: ${ev.name}`;
      try{
        const res = await fetch(`/events/${ev._id}/matches`,{credentials:'include'});
        const matches = await res.json();
        eventMatchesList.innerHTML = matches.length
          ? matches.map(m=>`<div>${m.teamA.join(', ')} vs ${m.teamB.join(', ')}</div>`).join('')
          : 'No hay partidas aún';
        eventMatchesPanel.style.display='block';
      }catch(err){console.error(err);}
    });
  });
}

createEventBtn.addEventListener('click', async ()=>{
  const name = document.getElementById('eventName').value.trim();
  const teamSize = document.getElementById('eventTeamSize').value;
  const numTeams = document.getElementById('eventNumTeams').value;
  if(!name||!teamSize||!numTeams) return alert('Completa todos los campos');

  try{
    const res = await fetch('/events',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'include',
      body:JSON.stringify({name,teamSize,numTeams})
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error||'Error al crear evento');
    document.getElementById('eventName').value='';
    document.getElementById('eventTeamSize').value='';
    document.getElementById('eventNumTeams').value='';
    loadEvents();
  }catch(err){alert(err.message);}
});

closeEventMatches.addEventListener('click', ()=>{ eventMatchesPanel.style.display='none'; });

// --- Inicializar ---
loadPlayers();
loadMatches();
loadEvents();
