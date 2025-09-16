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
    const response = await fetch(`${API_BASE_URL}/auth/user`, {
        credentials: "include" // 👈 cookie en cada request
    });
    if (!response.ok) throw new Error('No autenticado');
    return response.json();
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
// 🚀 Init
// ==============================
document.addEventListener('DOMContentLoaded', initializeApp);
