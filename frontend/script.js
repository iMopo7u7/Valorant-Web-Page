// ==============================
// 🌐 API Configuration
// ==============================
const API_BASE_URL = window.location.origin.includes('localhost') 
    ? 'http://localhost:3000/api' 
    : 'https://valorant-10-mans.onrender.com/api';

// ==============================
// 🎮 Global State Management
// ==============================
const AppState = {
    user: null,
    currentSection: 'public',
    currentTab: { public: 'queue', premier: 'queue', profile: 'overview' },
    selectedRoles: [],
    userState: 'idle',
    currentMatch: null,
    isEliteQueue: false,
    queues: { public: [], elite: [] },
    leaderboard: [],
    userMatches: { public: [], elite: [] },
    userStates: {
        IDLE: 'idle',
        IN_QUEUE: 'in_queue',
        IN_MATCH: 'in_match',
        MATCH_LEADER: 'match_leader',
        WAITING_ROOM_CODE: 'waiting_room_code',
        WAITING_MATCH_URL: 'waiting_match_url'
    }
};

// ==============================
// 🖼️ DOM Elements
// ==============================
const elements = {
    loadingScreen: document.getElementById('loadingScreen'),
    loginScreen: document.getElementById('loginScreen'),
    setupPanel: document.getElementById('setupPanel'),
    dashboard: document.getElementById('dashboard'),
    discordLoginBtn: document.getElementById('discordLoginBtn'),
    riotIdInput: document.getElementById('riotId'),
    roleCards: document.querySelectorAll('.role-card'),
    completeSetupBtn: document.getElementById('completeSetupBtn'),
    userAvatar: document.getElementById('userAvatar'),
    usernameDisplay: document.getElementById('username'),
    logoutBtn: document.getElementById('logoutBtn'),
    navItems: document.querySelectorAll('.nav-item'),
    sections: document.querySelectorAll('.section'),
    publicSection: document.getElementById('publicSection'),
    premierSection: document.getElementById('premierSection'),
    profileSection: document.getElementById('profileSection'),
    publicActivePlayers: document.getElementById('publicActivePlayers'),
    publicMatchesToday: document.getElementById('publicMatchesToday'),
    publicUserRating: document.getElementById('publicUserRating'),
    publicUserRank: document.getElementById('publicUserRank'),
    tabButtons: document.querySelectorAll('.tab-btn'),
    publicQueueContent: document.getElementById('publicQueueContent'),
    publicMatchesContent: document.getElementById('publicMatches'),
    publicLeaderboardContent: document.getElementById('publicLeaderboard'),
    publicMymatchesContent: document.getElementById('publicMymatches'),
    profileAvatar: document.getElementById('profileAvatar'),
    profileUsername: document.getElementById('profileUsername'),
    profileRiotId: document.getElementById('profileRiotId'),
    profileRoles: document.getElementById('profileRoles'),
    premierStatusBadge: document.getElementById('premierStatusBadge'),
    adminStatusBadge: document.getElementById('adminStatusBadge'),
    memberSince: document.getElementById('memberSince'),
    totalMatches: document.getElementById('totalMatches'),
    winRate: document.getElementById('winRate'),
    updateRiotName: document.getElementById('updateRiotName'),
    updateRiotTag: document.getElementById('updateRiotTag'),
    roleSelectBtns: document.querySelectorAll('.role-select-btn'),
    updateProfileBtn: document.getElementById('updateProfileBtn'),
    publicStats: document.getElementById('publicStats'),
    eliteStats: document.getElementById('eliteStats'),
    toastContainer: document.getElementById('toastContainer')
};

// ==============================
// 📺 UI Helpers
// ==============================
const showScreen = (screenId) => {
    elements.loginScreen.classList.add('hidden');
    elements.setupPanel.classList.add('hidden');
    elements.dashboard.classList.add('hidden');
    elements.loadingScreen.classList.add('hidden');
    document.getElementById(screenId).classList.remove('hidden');
};

const showToast = (message, type = 'success') => {
    const toast = document.createElement('div');
    toast.className = `p-4 rounded-lg shadow-xl text-white fade-in max-w-xs`;
    
    if (type === 'success') toast.classList.add('bg-green-600');
    else if (type === 'error') toast.classList.add('bg-red-600');
    else if (type === 'info') toast.classList.add('bg-blue-600');
    
    toast.textContent = message;
    elements.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.remove('fade-in');
        toast.classList.add('fade-out');
        toast.remove();
    }, 5000);
};

// ==============================
// 🔑 Auth & App Init
// ==============================
const fetchUser = async () => {
    const response = await fetch(`${API_BASE_URL}/users/me`, {
        credentials: "include"
    });
    if (!response.ok) throw new Error('No autenticado');
    return response.json();
};

const updateUIWithUser = (user) => {
    elements.userAvatar.src = user.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
    elements.profileAvatar.src = user.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
    elements.usernameDisplay.textContent = user.discordTag;
    elements.profileUsername.textContent = user.discordTag;
    
    if (user.riotId) {
        elements.profileRiotId.textContent = user.riotId;
        elements.updateRiotName.value = user.riotId.split('#')[0];
        elements.updateRiotTag.value = user.riotId.split('#')[1];
    }

    if (user.memberSince) {
        const date = new Date(user.memberSince);
        elements.memberSince.textContent = date.toLocaleDateString('es-ES');
    }

    elements.profileRoles.innerHTML = '';
    if (user.roles && user.roles.length > 0) {
        user.roles.forEach(role => {
            const roleTag = document.createElement('span');
            roleTag.className = `role-tag role-${role}`;
            roleTag.textContent = role.charAt(0).toUpperCase() + role.slice(1);
            elements.profileRoles.appendChild(roleTag);
        });
    }

    if (user.isElite) {
        elements.premierStatusBadge.classList.remove('bg-gray-700', 'text-gray-300');
        elements.premierStatusBadge.classList.add('bg-yellow-600', 'text-black');
        elements.premierStatusBadge.innerHTML = '<i class="fas fa-crown mr-1"></i> Elite: Verificado';
    } else {
        elements.premierStatusBadge.classList.remove('bg-yellow-600', 'text-black');
        elements.premierStatusBadge.classList.add('bg-gray-700', 'text-gray-300');
        elements.premierStatusBadge.innerHTML = '<i class="fas fa-crown mr-1"></i> Elite: Pendiente';
    }

    if (user.isAdmin) {
        elements.adminStatusBadge.classList.remove('hidden');
    } else {
        elements.adminStatusBadge.classList.add('hidden');
    }
};

const initializeApp = async () => {
    showScreen('loadingScreen');

    try {
        const user = await fetchUser();
        AppState.user = user;
        updateUIWithUser(user);

        if (!user.riotId || !user.roles || user.roles.length === 0) {
            showScreen('setupPanel');
        } else {
            showScreen('dashboard');
            await fetchDashboardData();
            startPolling();
        }
    } catch (error) {
        console.error("Error al iniciar la aplicación:", error);
        showScreen('loginScreen');
        showToast('Sesión caducada. Por favor, inicia sesión de nuevo.', 'error');
    }
};

// ==============================
// 📊 Dashboard Data
// ==============================
const fetchDashboardData = async () => {
    try {
        const [publicStats, premierStats, queues, leaderboard] = await Promise.all([
            fetch(`${API_BASE_URL}/stats/public`, { credentials: "include" }),
            fetch(`${API_BASE_URL}/stats/premier`, { credentials: "include" }),
            fetch(`${API_BASE_URL}/queues`, { credentials: "include" }),
            fetch(`${API_BASE_URL}/leaderboard`, { credentials: "include" })
        ]);

        const publicStatsData = await publicStats.json();
        const premierStatsData = await premierStats.json();
        const queuesData = await queues.json();
        const leaderboardData = await leaderboard.json();

        updateStats(publicStatsData, 'public');
        updateStats(premierStatsData, 'elite');
        AppState.queues = queuesData;
        AppState.leaderboard = leaderboardData;

        renderQueue();
    } catch (error) {
        console.error("Error fetching dashboard data:", error);
        showToast('Error al cargar los datos del dashboard.', 'error');
    }
};

// ==============================
// 📝 Setup Usuario
// ==============================
elements.completeSetupBtn.addEventListener('click', async () => {
    const riotId = elements.riotIdInput.value.trim();
    if (!riotId) return showToast('Por favor, ingresa tu Riot ID.', 'error');
    if (AppState.selectedRoles.length === 0) return showToast('Selecciona al menos un rol.', 'error');

    try {
        const response = await fetch(`${API_BASE_URL}/users/setup`, {
            method: 'POST',
            credentials: "include",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ riotId, roles: AppState.selectedRoles })
        });

        if (!response.ok) throw new Error("Error en setup");
        const user = await response.json();
        AppState.user = user;
        updateUIWithUser(user);
        showScreen('dashboard');
        showToast('¡Configuración completada con éxito!');
        await fetchDashboardData();
    } catch (error) {
        console.error("Setup error:", error);
        showToast(error.message, 'error');
    }
});

// ==============================
// 🎮 Queue Handling
// ==============================
const renderQueue = () => {
    const queueContent = AppState.isEliteQueue ? elements.premierQueueContent : elements.publicQueueContent;
    const currentQueue = AppState.isEliteQueue ? AppState.queues.elite : AppState.queues.public;

    queueContent.innerHTML = '';

    const queueHeader = document.createElement('div');
    queueHeader.className = 'flex items-center justify-between mb-4';
    queueHeader.innerHTML = `
        <h3 class="text-xl md:text-2xl font-bold">Cola de Partidas <span class="text-primary">(${currentQueue.length}/10)</span></h3>
        <button id="queueBtn" class="btn-primary px-6 py-3 rounded-lg font-semibold">
            ${AppState.userState === AppState.userStates.IN_QUEUE ? 'Abandonar Cola' : 'Unirse a la Cola'}
        </button>
    `;
    queueContent.appendChild(queueHeader);

    const queueGrid = document.createElement('div');
    queueGrid.className = 'grid grid-cols-2 md:grid-cols-5 gap-4 md:gap-6';
    
    currentQueue.forEach(player => {
        const playerCard = document.createElement('div');
        playerCard.className = 'card p-4 text-center fade-in';
        playerCard.innerHTML = `
            <img src="${player.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'}" alt="Avatar" class="w-16 h-16 rounded-full mx-auto mb-2">
            <h4 class="font-semibold text-sm truncate">${player.discordUsername}</h4>
            <p class="text-xs text-gray-400 truncate">${player.riotId}</p>
        `;
        queueGrid.appendChild(playerCard);
    });

    for (let i = currentQueue.length; i < 10; i++) {
        const emptyCard = document.createElement('div');
        emptyCard.className = 'card p-4 text-center opacity-50';
        emptyCard.innerHTML = `
            <div class="w-16 h-16 rounded-full mx-auto mb-2 bg-gray-700 flex items-center justify-center">
                <i class="fas fa-plus text-2xl text-gray-500"></i>
            </div>
            <h4 class="font-semibold text-sm text-gray-400">Esperando...</h4>
            <p class="text-xs text-gray-500">Espacio disponible</p>
        `;
        queueGrid.appendChild(emptyCard);
    }

    queueContent.appendChild(queueGrid);

    document.getElementById('queueBtn').addEventListener('click', () => {
        if (AppState.userState === AppState.userStates.IN_QUEUE) leaveQueue();
        else joinQueue();
    });
};

const joinQueue = async () => {
    try {
        const response = await fetch(`${API_BASE_URL}/queues/${AppState.isEliteQueue ? 'elite' : 'public'}/join`, {
            method: 'POST',
            credentials: "include",
            headers: { 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error("Error al unirse a la cola");
        const result = await response.json();
        AppState.userState = AppState.userStates.IN_QUEUE;
        showToast(result.message);
    } catch (error) {
        console.error("Join queue error:", error);
        showToast(error.message, 'error');
    }
};

const leaveQueue = async () => {
    try {
        const response = await fetch(`${API_BASE_URL}/queues/${AppState.isEliteQueue ? 'elite' : 'public'}/leave`, {
            method: 'POST',
            credentials: "include",
            headers: { 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error("Error al salir de la cola");
        const result = await response.json();
        AppState.userState = AppState.userStates.IDLE;
        showToast(result.message);
    } catch (error) {
        console.error("Leave queue error:", error);
        showToast(error.message, 'error');
    }
};

// ==============================
// 📈 Stats Helper
// ==============================
const updateStats = (data, type) => {
    const isPublic = type === 'public';
    const activePlayersEl = isPublic ? elements.publicActivePlayers : document.getElementById('eliteActivePlayers');
    const matchesTodayEl = isPublic ? elements.publicMatchesToday : document.getElementById('eliteMatchesToday');
    const userRatingEl = isPublic ? elements.publicUserRating : document.getElementById('eliteUserRating');
    const userRankEl = isPublic ? elements.publicUserRank : document.getElementById('eliteUserRank');
    const userStatsContainer = isPublic ? elements.publicStats : elements.eliteStats;

    if (data.activePlayers) activePlayersEl.textContent = data.activePlayers;
    if (data.matchesToday) matchesTodayEl.textContent = data.matchesToday;
    if (data.userRating) userRatingEl.textContent = Math.round(data.userRating);
    if (data.userRank) userRankEl.textContent = `#${data.userRank}`;

    userStatsContainer.innerHTML = `
        <div class="flex justify-between">
            <span>Rating</span>
            <span class="font-semibold">${Math.round(data.userRating || 0)}</span>
        </div>
        <div class="flex justify-between">
            <span>Ranking</span>
            <span class="font-semibold">#${data.userRank || 'N/A'}</span>
        </div>
        <div class="flex justify-between">
            <span>Partidas jugadas</span>
            <span class="font-semibold">${data.matchesPlayed || 0}</span>
        </div>
        <div class="flex justify-between">
            <span>Victorias</span>
            <span class="font-semibold">${data.wins || 0}</span>
        </div>
        <div class="flex justify-between">
            <span>Porcentaje de victorias</span>
            <span class="font-semibold">${data.winRate ? (data.winRate * 100).toFixed(1) : 0}%</span>
        </div>
    `;
};

// ==============================
// 🔄 Polling
// ==============================
const startPolling = () => {
    setInterval(async () => {
        if (AppState.userState !== AppState.userStates.IN_MATCH) {
            await fetchDashboardData();
        }
    }, 5000);
};

// ==============================
// 🛠️ Event Listeners
// ==============================
document.addEventListener('DOMContentLoaded', initializeApp);

elements.discordLoginBtn.addEventListener('click', () => {
    window.location.href = `${API_BASE_URL}/auth/discord`;
});

elements.logoutBtn.addEventListener('click', async () => {
    try {
        await fetch(`${API_BASE_URL}/auth/logout`, {
            method: "POST",
            credentials: "include"
        });
    } catch (err) {
        console.error("Logout error:", err);
    }
    showScreen('loginScreen');
    showToast('Sesión cerrada correctamente.');
});

elements.roleCards.forEach(card => {
    card.addEventListener('click', () => {
        const role = card.dataset.role;
        const index = AppState.selectedRoles.indexOf(role);
        if (index > -1) {
            AppState.selectedRoles.splice(index, 1);
            card.classList.remove('border-2', 'border-primary');
        } else if (AppState.selectedRoles.length < 2) {
            AppState.selectedRoles.push(role);
            card.classList.add('border-2', 'border-primary');
        } else {
            showToast('Solo puedes seleccionar un máximo de 2 roles.', 'warning');
        }
    });
});

elements.navItems.forEach(item => {
    item.addEventListener('click', () => {
        const section = item.dataset.section;
        AppState.currentSection = section;

        elements.sections.forEach(s => s.classList.add('hidden'));
        document.getElementById(`${section}Section`).classList.remove('hidden');

        elements.navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        AppState.isEliteQueue = section === 'premier';
        if (section === 'public' || section === 'premier') renderQueue();
        else if (section === 'profile') updateUIWithUser(AppState.user);
    });
});
