const API_BASE = 'https://valorant-10-mans.onrender.com';
let currentUser = null;
let isInQueue = false;
let queueStartTime = null;
let queueTimer = null;
let currentMatch = null;
const maps = ['Ascent', 'Bind', 'Haven', 'Icebox', 'Breeze'];

document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus();
    setInterval(async () => {
        if(currentUser) await checkQueueStatus();
    }, 10000);
});

// =========================
// AUTHENTICACIÓN
// =========================
async function checkAuthStatus() {
    try {
        const res = await fetch(`${API_BASE}/api/users/me`, { credentials: 'include' });
        if(res.ok){
            currentUser = await res.json();
            showUserInterface();
            await checkQueueStatus();
        } else {
            showLoginInterface();
        }
    } catch(e){
        console.error(e);
        showLoginInterface();
    }
}

function loginWithDiscord(){
    window.location.href = `${API_BASE}/api/auth/discord`;
}

function showLoginInterface(){
    document.getElementById('loginSection').style.display = 'block';
    document.getElementById('userCard').style.display = 'none';
    document.getElementById('lobbyContainer').style.display = 'none';
}

function showUserInterface(){
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('userCard').style.display = 'block';
    document.getElementById('userAvatar').src = currentUser.avatar
        ? `https://cdn.discordapp.com/avatars/${currentUser.discordId}/${currentUser.avatar}.png`
        : '/assets/placeholder.svg';
    document.getElementById('userName').textContent = currentUser.username || 'Usuario';

    const riotInput = document.getElementById('riotIdInput');
    const riotBtn = document.getElementById('riotIdBtn');
    riotInput.value = currentUser.riotId || '';
    if(!currentUser.riotId || !currentUser.riotIdChanged){
        riotInput.disabled = false;
        riotBtn.style.display = 'inline-block';
    } else {
        riotInput.disabled = true;
        riotBtn.style.display = 'none';
    }
    updateUserStatus();
}

async function handleRiotIdChange(){
    const riotId = document.getElementById('riotIdInput').value.trim();
    if(!riotId) { alert("Ingresa un Riot ID válido"); return; }

    try {
        const res = await fetch(`${API_BASE}/api/users/update-riot`, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            credentials:'include',
            body: JSON.stringify({ riotId })
        });
        const data = await res.json();
        if(res.ok){
            currentUser.riotId = riotId;
            if(!currentUser.riotIdChanged) currentUser.riotIdChanged = true;
            showUserInterface();
        } else {
            alert(data.error || "Error al actualizar Riot ID");
        }
    } catch(e){
        console.error(e);
        alert("Error de conexión con el servidor");
    }
}

function updateUserStatus(){
    const statusElement = document.getElementById('userStatus');
    if(!currentUser.riotId){
        statusElement.textContent = '⚠️ Registra tu Riot ID para jugar';
    } else if(isInQueue){
        statusElement.textContent = '🔄 En cola...';
    } else {
        statusElement.textContent = 'Listo para jugar';
    }
}

// =========================
// COLA
// =========================
async function toggleQueue(){
    if(!currentUser.riotId){
        alert("Debes registrar tu Riot ID primero");
        return;
    }
    if(isInQueue) await leaveQueue();
    else await joinQueue();
}

async function joinQueue(){
    try{
        const res = await fetch(`${API_BASE}/api/queue/join`, {
            method:'POST',
            credentials:'include'
        });
        if(res.ok){
            const data = await res.json();
            isInQueue = true;
            queueStartTime = Date.now();
            startQueueTimer();
            updateUserStatus();
            if(data.match){
                currentMatch = data.match;
                showLobby(currentMatch);
            }
        }
    } catch(e){ console.error(e); }
}

async function leaveQueue(){
    try{
        const res = await fetch(`${API_BASE}/api/queue/leave-global`, {
            method:'POST',
            credentials:'include'
        });
        if(res.ok){
            isInQueue = false;
            queueStartTime = null;
            stopQueueTimer();
            updateUserStatus();
        }
    } catch(e){ console.error(e); }
}

async function checkQueueStatus(){
    try{
        const res = await fetch(`${API_BASE}/api/queue/my-match`, { credentials:'include' });
        if(!res.ok) return;
        const data = await res.json();
        if(data.match){
            currentMatch = data.match;
            showLobby(data.match);
        } else if(data.inQueueGlobal){
            isInQueue = true;
            queueStartTime = Date.now();
            startQueueTimer();
            updateUserStatus();
        } else {
            isInQueue = false;
            currentMatch = null;
            stopQueueTimer();
            updateUserStatus();
            hideLobby();
        }
    } catch(e){ console.error(e); }
}

function startQueueTimer(){
    const timerEl = document.getElementById('queueTimer');
    const timerValue = document.getElementById('timerValue');
    timerEl.style.display = 'block';
    queueTimer = setInterval(()=>{
        if(!queueStartTime) return;
        const elapsed = Math.floor((Date.now()-queueStartTime)/1000);
        const min = String(Math.floor(elapsed/60)).padStart(2,'0');
        const sec = String(elapsed%60).padStart(2,'0');
        timerValue.textContent = `${min}:${sec}`;
    }, 1000);
}

function stopQueueTimer(){
    const timerEl = document.getElementById('queueTimer');
    timerEl.style.display = 'none';
    if(queueTimer) clearInterval(queueTimer);
    queueTimer = null;
}

// =========================
// LOBBY
// =========================
function showLobby(match){
    document.getElementById('userCard').style.display = 'none';
    document.getElementById('lobbyContainer').style.display = 'block';
    document.getElementById('lobbyMap').textContent = match.map || getRandomMap();
    document.getElementById('lobbyLeader').textContent = match.leader?.username || 'Desconocido';

    renderTeam('teamAPlayers', match.teamA||[]);
    renderTeam('teamBPlayers', match.teamB||[]);

    // Mostrar panel de líder si corresponde
    if(String(match.leader.id) === String(currentUser.discordId)){
        document.getElementById('leaderPanel').style.display = 'block';
    } else {
        document.getElementById('leaderPanel').style.display = 'none';
    }
}

function hideLobby(){
    document.getElementById('userCard').style.display = 'block';
    document.getElementById('lobbyContainer').style.display = 'none';
}

function renderTeam(containerId, players){
    const cont = document.getElementById(containerId);
    cont.innerHTML = '';
    players.forEach(p=>{
        const div = document.createElement('div');
        div.textContent = `${p.username || 'Jugador'} (${p.riotId || 'Sin Riot ID'}) ${currentMatch.leader.id===p.id?'👑':' '}`;
        cont.appendChild(div);
    });
}

function getRandomMap(){
    return maps[Math.floor(Math.random()*maps.length)];
}

// =========================
// PANEL DE LÍDER
// =========================
async function submitRoomCode(){
    const val = document.getElementById('roomCodeInput').value.trim();
    if(!val){ alert('Ingresa código'); return; }
    try{
        const res = await fetch(`${API_BASE}/api/match/submit-room`, {
            method:'POST',
            credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ roomCode: val })
        });
        const data = await res.json();
        if(res.ok){ alert('Código de sala enviado'); }
        else alert(data.error || 'Error al enviar código');
    } catch(e){ console.error(e); }
}

async function submitTrackerUrl(){
    const val = document.getElementById('trackerUrlInput').value.trim();
    if(!val){ alert('Ingresa URL'); return; }
    try{
        const res = await fetch(`${API_BASE}/api/match/submit-tracker`, {
            method:'POST',
            credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ trackerUrl: val })
        });
        const data = await res.json();
        if(res.ok){ 
            alert('Tracker subido, partida finalizada');
            hideLobby();
            currentMatch = null;
            showUserInterface();
        }
        else alert(data.error || 'Error al subir tracker');
    } catch(e){ console.error(e); }
}
