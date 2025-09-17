// ==========================================================
// CONFIGURACIÓN E INICIALIZACIÓN
// ==========================================================

// API Configuration
const API_BASE_URL = window.location.origin.includes('localhost')
    ? 'http://localhost:3000/api'
    : 'https://valorant-10-mans.onrender.com/api';

// Global State Management
const AppState = {
    user: null,
    currentSection: 'public',
    currentTab: { public: 'queue', premier: 'queue', profile: 'overview' },
    selectedRoles: [],
    userState: 'idle',
    currentMatch: null,
    isEliteQueue: false,
    queues: { public: [], elite: [] },
    leaderboard: { public: [], elite: [] },
    matches: { public: [], elite: [] },
    userMatches: { public: [], elite: [] },
    
    // User states for backend integration
    userStates: {
        IDLE: 'idle',
        IN_QUEUE: 'in_queue',
        IN_MATCH: 'in_match',
        MATCH_LEADER: 'match_leader',
        WAITING_ROOM_CODE: 'waiting_room_code',
        WAITING_MATCH_END: 'waiting_match_end',
    }
};

// DOM Elements
const loadingScreen = document.getElementById('loadingScreen');
const loginScreen = document.getElementById('loginScreen');
const setupPanel = document.getElementById('setupPanel');
const dashboard = document.getElementById('dashboard');
const discordLoginBtn = document.getElementById('discordLoginBtn');
const completeSetupBtn = document.getElementById('completeSetupBtn');
const logoutBtn = document.getElementById('logoutBtn');
const navItems = document.querySelectorAll('.nav-item');
const publicSection = document.getElementById('publicSection');
const premierSection = document.getElementById('premierSection');
const profileSection = document.getElementById('profileSection');
const roleCards = document.querySelectorAll('.role-card');
const profileRiotId = document.getElementById('profileRiotId');
const profileRoles = document.getElementById('profileRoles');
const updateProfileBtn = document.getElementById('updateProfileBtn');
const updateRiotName = document.getElementById('updateRiotName');
const updateRiotTag = document.getElementById('updateRiotTag');
const roleSelectBtns = document.querySelectorAll('.role-select-btn');
const toastContainer = document.getElementById('toastContainer');
const publicTabButtons = publicSection.querySelectorAll('.tab-btn');
const premierTabButtons = premierSection.querySelectorAll('.tab-btn');

// Queue Buttons
const joinPublicQueueBtn = document.getElementById('joinPublicQueueBtn');
const leavePublicQueueBtn = document.getElementById('leavePublicQueueBtn');
const publicQueueContainer = document.getElementById('publicQueueContainer');
const publicLeaderboardContainer = document.getElementById('publicLeaderboardContainer');
const publicMatchesContainer = document.getElementById('publicMatchesContainer');
const publicPlayerCount = document.getElementById('publicPlayerCount');

// Profile Page Elements
const myMatchesContainer = document.getElementById('myMatchesContainer');
const profileInfoContainer = document.getElementById('profileInfoContainer');
const myMatchesPlayerCount = document.getElementById('myMatchesPlayerCount');

// ==========================================================
// FUNCIONES DE UTILIDAD
// ==========================================================

const showToast = (message, type = 'success') => {
    const toast = document.createElement('div');
    toast.className = `p-4 rounded-lg shadow-xl text-white fade-in transform transition-all duration-300 ${
        type === 'success' ? 'bg-green-500' :
        type === 'error' ? 'bg-red-500' :
        'bg-gray-700'
    }`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.classList.remove('fade-in');
        toast.classList.add('fade-out');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 5000);
};

const updateTabContent = (parent, buttons, activeTab) => {
    parent.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
        content.classList.remove('active');
    });
    parent.querySelector(`#${parent.id.replace('Section', '')}-${activeTab}`).classList.remove('hidden');
    parent.querySelector(`#${parent.id.replace('Section', '')}-${activeTab}`).classList.add('active');

    buttons.forEach(btn => {
        btn.classList.remove('bg-primary', 'text-white', 'hover:bg-gray-700');
        btn.classList.add('text-gray-300', 'hover:text-white', 'hover:bg-gray-700');
    });

    const activeBtn = parent.querySelector(`.tab-btn[data-tab="${activeTab}"]`);
    activeBtn.classList.add('bg-primary', 'text-white');
    activeBtn.classList.remove('text-gray-300');
};

// ==========================================================
// FUNCIONES DE RENDERIZADO DE LA INTERFAZ
// ==========================================================

const renderPlayerCard = (player) => {
    return `
    <div class="p-4 bg-gray-800 rounded-lg flex items-center justify-between">
        <div class="flex items-center">
            <img src="${player.avatarURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}" alt="Avatar" class="w-10 h-10 rounded-full mr-4">
            <div>
                <p class="text-white font-semibold">${player.username}</p>
                <p class="text-gray-400 text-sm">${player.roles.join(', ')}</p>
            </div>
        </div>
    </div>
    `;
};

const renderQueue = (queue) => {
    const queueHtml = queue.map(player => renderPlayerCard(player)).join('');
    publicQueueContainer.innerHTML = queueHtml;
    publicPlayerCount.textContent = `${queue.length}/10 jugadores`;
    
    // Botones de cola
    if (AppState.userState === AppState.userStates.IN_QUEUE) {
        joinPublicQueueBtn.classList.add('hidden');
        leavePublicQueueBtn.classList.remove('hidden');
    } else {
        joinPublicQueueBtn.classList.remove('hidden');
        leavePublicQueueBtn.classList.add('hidden');
    }
};

const renderLeaderboard = (leaderboard) => {
    const leaderboardHtml = leaderboard.map((player, index) => `
    <div class="p-4 bg-gray-800 rounded-lg flex items-center justify-between">
        <div class="flex items-center">
            <span class="text-lg font-bold text-gray-400 mr-4 w-6 text-center">${index + 1}</span>
            <img src="${player.avatarURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}" alt="Avatar" class="w-10 h-10 rounded-full mr-4">
            <div>
                <p class="text-white font-semibold">${player.username} <span class="text-gray-400 text-sm">#${player.riotId?.split('#')[1]}</span></p>
                <p class="text-gray-400 text-sm">${player.roles.join(', ')}</p>
            </div>
        </div>
        <span class="text-lg font-bold text-primary">${player.score}</span>
    </div>
    `).join('');
    publicLeaderboardContainer.innerHTML = leaderboardHtml;
};

const renderMatches = (matches, container) => {
    const matchesHtml = matches.map(match => `
    <div class="p-4 bg-gray-800 rounded-lg shadow-md mb-4">
        <h3 class="text-white text-lg font-bold mb-2">Partida de 10 mans - ${match.map}</h3>
        <p class="text-gray-400 text-sm mb-4">Finalizada: ${new Date(match.createdAt).toLocaleString()}</p>
        <div class="grid grid-cols-2 gap-4">
            <div>
                <h4 class="text-blue-400 font-semibold mb-2">Equipo A</h4>
                ${match.teamA.map(player => `
                    <p class="text-white text-sm">${player.username} <span class="text-gray-400 text-xs">(${player.character})</span> - <span class="text-gray-400 text-xs">${player.kills}/${player.deaths}/${player.assists}</span></p>
                `).join('')}
            </div>
            <div>
                <h4 class="text-red-400 font-semibold mb-2">Equipo B</h4>
                ${match.teamB.map(player => `
                    <p class="text-white text-sm">${player.username} <span class="text-gray-400 text-xs">(${player.character})</span> - <span class="text-gray-400 text-xs">${player.kills}/${player.deaths}/${player.assists}</span></p>
                `).join('')}
            </div>
        </div>
    </div>
    `).join('');
    container.innerHTML = matchesHtml;
};

const renderProfileOverview = (user) => {
    profileInfoContainer.innerHTML = `
    <div class="bg-gray-800 rounded-lg p-6">
        <h3 class="text-white text-xl font-bold mb-4">Estadísticas Públicas</h3>
        <div class="grid grid-cols-2 gap-4">
            <div>
                <p class="text-gray-400 text-sm">Puntuación Total</p>
                <p class="text-white text-2xl font-bold">${user.stats?.public?.score || 0}</p>
            </div>
            <div>
                <p class="text-gray-400 text-sm">Partidas Jugadas</p>
                <p class="text-white text-2xl font-bold">${user.stats?.public?.matchesPlayed || 0}</p>
            </div>
            <div>
                <p class="text-gray-400 text-sm">Victorias</p>
                <p class="text-white text-2xl font-bold">${user.stats?.public?.wins || 0}</p>
            </div>
            <div>
                <p class="text-gray-400 text-sm">Ratio K/D</p>
                <p class="text-white text-2xl font-bold">${(user.stats?.public?.kills / Math.max(1, user.stats?.public?.deaths)).toFixed(2) || 'N/A'}</p>
            </div>
        </div>
    </div>
    `;
};

// ==========================================================
// LÓGICA DE LA APLICACIÓN
// ==========================================================

const fetchAndRenderData = async () => {
    try {
        if (AppState.currentSection === 'public') {
            if (AppState.currentTab.public === 'queue') {
                const response = await fetch(`${API_BASE_URL}/public/queue`);
                if (!response.ok) throw new Error('Error al obtener la cola pública.');
                const queue = await response.json();
                renderQueue(queue);
            } else if (AppState.currentTab.public === 'leaderboard') {
                const response = await fetch(`${API_BASE_URL}/public/leaderboard`);
                if (!response.ok) throw new Error('Error al obtener el leaderboard.');
                const leaderboard = await response.json();
                renderLeaderboard(leaderboard);
            } else if (AppState.currentTab.public === 'matches') {
                const response = await fetch(`${API_BASE_URL}/public/matches`);
                if (!response.ok) throw new Error('Error al obtener las partidas.');
                const data = await response.json();
                renderMatches(data.matches, publicMatchesContainer);
            }
        } else if (AppState.currentSection === 'profile') {
            if (AppState.currentTab.profile === 'overview') {
                // Ya se tiene el usuario en AppState.user
                renderProfileOverview(AppState.user);
            } else if (AppState.currentTab.profile === 'matches') {
                const response = await fetch(`${API_BASE_URL}/public/mymatches`);
                if (!response.ok) throw new Error('Error al obtener tus partidas.');
                const data = await response.json();
                renderMatches(data.matches, myMatchesContainer);
            }
            // Update profile edit fields
            const riotId = AppState.user.riotId || '#';
            updateRiotName.value = riotId.split('#')[0] || '';
            updateRiotTag.value = riotId.split('#')[1] || '';
        }
        // TODO: Premier section
        // if (AppState.currentSection === 'premier') { ... }
    } catch (error) {
        console.error("Fetch and render error:", error);
        showToast(error.message, "error");
    }
};

const renderApp = () => {
    loadingScreen.classList.add('hidden');
    loginScreen.classList.add('hidden');
    setupPanel.classList.add('hidden');
    dashboard.classList.add('hidden');

    if (!AppState.user) {
        loginScreen.classList.remove('hidden');
    } else if (!AppState.user.riotId || !AppState.user.roles || AppState.user.roles.length === 0) {
        setupPanel.classList.remove('hidden');
    } else {
        dashboard.classList.remove('hidden');
        renderDashboard();
    }
};

const renderDashboard = () => {
    // Update header info
    document.getElementById('userAvatar').src = AppState.user.avatarURL || 'https://cdn.discordapp.com/embed/avatars/0.png';
    document.getElementById('username').textContent = AppState.user.username;

    // Show/Hide sections
    publicSection.classList.add('hidden');
    premierSection.classList.add('hidden');
    profileSection.classList.add('hidden');

    if (AppState.currentSection === 'public') {
        publicSection.classList.remove('hidden');
        updateTabContent(publicSection, publicTabButtons, AppState.currentTab.public);
    } else if (AppState.currentSection === 'premier') {
        premierSection.classList.remove('hidden');
        updateTabContent(premierSection, premierTabButtons, AppState.currentTab.premier);
    } else if (AppState.currentSection === 'profile') {
        profileSection.classList.remove('hidden');
    }

    fetchAndRenderData();
};

const checkAuthAndRender = async () => {
    loadingScreen.classList.remove('hidden');
    try {
        const response = await fetch(`${API_BASE_URL}/user/me`);
        if (response.ok) {
            AppState.user = await response.json();
        } else {
            AppState.user = null; // No authenticated session
        }
    } catch (error) {
        console.error("Error checking auth:", error);
        AppState.user = null;
    } finally {
        renderApp();
    }
};

// ==========================================================
// EVENT LISTENERS
// ==========================================================

discordLoginBtn.addEventListener('click', () => {
    window.location.href = `${API_BASE_URL}/auth/discord`;
});

completeSetupBtn.addEventListener('click', async () => {
    const riotIdInput = document.getElementById('riotId').value;
    const [name, tag] = riotIdInput.split('#');
    
    if (!name || !tag || AppState.selectedRoles.length === 0) {
        showToast("Por favor, introduce un Riot ID válido (ej. Name#Tag) y selecciona al menos un rol.", "error");
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/user/setup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                riotId: riotIdInput,
                roles: AppState.selectedRoles,
            })
        });
        const data = await response.json();
        if (response.ok) {
            AppState.user = data;
            showToast("Perfil configurado correctamente.");
            renderApp();
        } else {
            showToast(data.error || "Error al completar la configuración.", "error");
        }
    } catch (error) {
        showToast("Error de red. Inténtalo de nuevo.", "error");
    }
});

updateProfileBtn.addEventListener('click', async () => {
    const newName = updateRiotName.value;
    const newTag = updateRiotTag.value;
    const newRiotId = `${newName}#${newTag}`;

    if (!newName || !newTag || AppState.selectedRoles.length === 0) {
        showToast("Por favor, completa todos los campos para actualizar tu perfil.", "error");
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/user/update`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                riotId: newRiotId,
                roles: AppState.selectedRoles,
            })
        });
        const data = await response.json();
        if (response.ok) {
            AppState.user.riotId = newRiotId;
            AppState.user.roles = AppState.selectedRoles;
            showToast(data.message);
            renderDashboard();
        } else {
            showToast(data.error || "Error al actualizar el perfil.", "error");
        }
    } catch (error) {
        showToast("Error de red. Inténtalo de nuevo.", "error");
    }
});

navItems.forEach(item => {
    item.addEventListener('click', () => {
        const section = item.dataset.section;
        AppState.currentSection = section;
        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        renderDashboard();
    });
});

publicTabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        AppState.currentTab.public = tab;
        updateTabContent(publicSection, publicTabButtons, tab);
        fetchAndRenderData();
    });
});

premierTabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        AppState.currentTab.premier = tab;
        updateTabContent(premierSection, premierTabButtons, tab);
        fetchAndRenderData();
    });
});

roleCards.forEach(card => {
    card.addEventListener('click', () => {
        const role = card.dataset.role;
        if (AppState.selectedRoles.includes(role)) {
            AppState.selectedRoles = AppState.selectedRoles.filter(r => r !== role);
            card.classList.remove('selected', 'bg-primary', 'text-white');
        } else if (AppState.selectedRoles.length < 2) {
            AppState.selectedRoles.push(role);
            card.classList.add('selected', 'bg-primary', 'text-white');
        } else {
            showToast("Solo puedes seleccionar un máximo de 2 roles.", "error");
        }
    });
});

// Queue logic
joinPublicQueueBtn.addEventListener('click', async () => {
    if (AppState.userState === AppState.userStates.IN_QUEUE) return;
    try {
        const response = await fetch(`${API_BASE_URL}/queue/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ matchType: 'public' })
        });
        const data = await response.json();
        if (response.ok) {
            AppState.userState = AppState.userStates.IN_QUEUE;
            showToast("Te has unido a la cola pública. Esperando jugadores...");
            renderQueue(data.queue); // Update queue list
        } else {
            showToast(data.error || "Error al unirte a la cola.", "error");
        }
    } catch (error) {
        showToast("Error de red al unirse a la cola.", "error");
    }
});

leavePublicQueueBtn.addEventListener('click', async () => {
    if (AppState.userState !== AppState.userStates.IN_QUEUE) return;
    try {
        const response = await fetch(`${API_BASE_URL}/queue/leave`, { // Assuming a /queue/leave endpoint
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ matchType: 'public' })
        });
        const data = await response.json();
        if (response.ok) {
            AppState.userState = AppState.userStates.IDLE;
            showToast("Has salido de la cola.");
            renderQueue(data.queue); // Update queue list
        } else {
            showToast(data.error || "Error al salir de la cola.", "error");
        }
    } catch (error) {
        showToast("Error de red al salir de la cola.", "error");
    }
});

// Logout
logoutBtn.addEventListener('click', () => {
    // In a real app, you would also clear the session on the server
    // For this example, we just clear the local state and redirect
    AppState.user = null;
    AppState.userState = AppState.userStates.IDLE;
    window.location.reload();
});


// ==========================================================
// INICIALIZACIÓN
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
    checkAuthAndRender();
    // Fetch initial queue and leaderboard data
    fetchAndRenderData();
    // You might also want to set up a polling or websocket connection
    // to get real-time updates for the queue.
    setInterval(fetchAndRenderData, 10000); // Poll every 10 seconds
});
