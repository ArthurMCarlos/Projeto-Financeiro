// Global variables
let currentUser = null;
let transactions = [];
let categories = [];
let incomes = [];
let budgets = [];
let accounts = [];
let goals = [];
let charts = {};

// API Base URL — usa a origem atual para funcionar em dev e produção
const API_BASE = window.location.origin;

// ── Proteção XSS — sempre usar em campos vindos da API antes de innerHTML ───
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}
// =====================================================
// KEEP-ALIVE MANAGER
// Mantém a conexão ativa com o servidor e banco de dados
// =====================================================

class KeepAliveManager {
    constructor() {
        this.pingInterval = 5 * 60 * 1000; // 5 minutos
        this.healthEndpoint = '/health';
        this.isRunning = false;
        this.timerId = null;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.retryDelay = 30000; // 30 segundos entre tentativas
    }

    // Inicia o keep-alive
    start() {
        if (this.isRunning) {
            console.log('KeepAlive já está ativo');
            return;
        }

        console.log('🔄 Iniciando KeepAlive Manager...');
        this.isRunning = true;
        this.retryCount = 0;

        // Faz uma requisição imediata
        this.ping();

        // Configura o intervalo para requisições periódicas
        this.timerId = setInterval(() => {
            this.ping();
        }, this.pingInterval);

        console.log(`✅ KeepAlive ativo - ping a cada ${this.pingInterval / 60000} minutos`);
    }

    // Para o keep-alive
    stop() {
        if (!this.isRunning) {
            return;
        }

        console.log('⏹️ Parando KeepAlive Manager...');
        this.isRunning = false;

        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
    }

    // Faz uma requisição de health check
    async ping() {
        try {
            const token = localStorage.getItem('token');

            const response = await fetch(`${API_BASE}${this.healthEndpoint}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token || ''}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.retryCount = 0; // Reset retry count on success
                console.log(`💓 KeepAlive: ${data.message || 'Servidor ativo'} - ${new Date().toLocaleTimeString('pt-BR')}`);
            } else if (response.status === 401) {
                // Token expirado, mas o servidor está ativo
                console.log('💓 KeepAlive: Servidor ativo (token expirado)');
                this.retryCount = 0;
            } else {
                console.warn('⚠️ KeepAlive: Resposta inesperada do servidor');
                this.handleError();
            }
        } catch (error) {
            console.error('❌ KeepAlive: Erro ao fazer ping', error.message);
            this.handleError();
        }
    }

    // Lida com erros de conexão
    handleError() {
        this.retryCount++;

        if (this.retryCount <= this.maxRetries) {
            console.log(`🔄 KeepAlive: Tentativa ${this.retryCount}/${this.maxRetries} - tentando novamente em ${this.retryDelay / 1000}s...`);

            setTimeout(() => {
                this.ping();
            }, this.retryDelay);
        } else {
            console.error('❌ KeepAlive: Número máximo de tentativas atingido. O serviço pode estar indisponível.');
            this.retryCount = 0; // Reset para tentar novamente no próximo intervalo
        }
    }
}

// Instância global do KeepAliveManager
const keepAliveManager = new KeepAliveManager();

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

async function initializeApp() {
    // Check authentication
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    // Set user info
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    currentUser = user;
    document.getElementById('userInfo').textContent = `Olá, ${user.name}`;

    // Initialize theme
    initializeTheme();

    // Initialize closing day select
    initializeClosingDaySelect();

    // Initialize keep-alive (antes de carregar dados)
    keepAliveManager.start();

    // Load all data
    await loadAllData();

    // Check credit card resets
    await checkCreditCardResets();

    // Initialize event listeners
    initializeEventListeners();

    // Initialize charts
    initializeCharts();
}

function toggleTheme() {
    const body       = document.body;
    const current    = body.getAttribute('data-theme') || 'light';
    const next       = current === 'dark' ? 'light' : 'dark';
    const icon       = next === 'dark' ? '☀️' : '🌙';

    body.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);

    const btn1 = document.getElementById('themeToggle');
    const btn2 = document.getElementById('themeToggleMobile');
    if (btn1) btn1.textContent = icon;
    if (btn2) btn2.textContent = icon;

    updateChartsTheme();
}

function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.body.setAttribute('data-theme', savedTheme);
    const icon = savedTheme === 'dark' ? '☀️' : '🌙';

    const btn1 = document.getElementById('themeToggle');
    const btn2 = document.getElementById('themeToggleMobile');
    if (btn1) { btn1.textContent = icon; btn1.addEventListener('click', toggleTheme); }
    if (btn2) { btn2.textContent = icon; btn2.addEventListener('click', toggleTheme); }
}


// =====================================================
// FUNÇÕES DE CARTÃO DE CRÉDITO
// =====================================================

// Inicializa o select de dias de fechamento (1-31)
function initializeClosingDaySelect() {
    const select = document.getElementById('accountClosingDay');
    if (!select) return;

    select.innerHTML = '';
    for (let day = 1; day <= 31; day++) {
        const option = document.createElement('option');
        option.value = day;
        option.textContent = `Dia ${day}`;
        select.appendChild(option);
    }
}

// Toggle campos de cartão de crédito no modal
function toggleCreditCardFields() {
    const accountType = document.getElementById('accountType').value;
    const creditCardFields = document.getElementById('creditCardFields');
    const balanceField = document.getElementById('balanceField');

    if (accountType === 'cartao') {
        creditCardFields.style.display = 'block';
        balanceField.style.display = 'none';
    } else {
        creditCardFields.style.display = 'none';
        balanceField.style.display = 'block';
    }
}

// Verifica e executa reset automático de cartões
async function checkCreditCardResets() {
    try {
        const response = await apiCall('/api/accounts/check-resets', {
            method: 'POST'
        });

        if (response && response.reset_cards && response.reset_cards.length > 0) {
            showCreditCardResetNotification(response.reset_cards);
            // Recarrega as contas para atualizar os saldos
            await loadAccounts();
        }
    } catch (error) {
        console.error('Erro ao verificar reset de cartões:', error);
    }
}

// Mostra notificação de reset de cartão
function showCreditCardResetNotification(resetCards) {
    const notification = document.getElementById('creditCardResetNotification');
    if (!notification) return;

    const cardNames = resetCards.map(card => card.name).join(', ');
    const text = resetCards.length === 1
        ? `O limite do cartão "${cardNames}" foi restaurado automaticamente!`
        : `Os limites dos cartões ${cardNames} foram restaurados automaticamente!`;

    notification.querySelector('.notification-text').textContent = text;
    notification.style.display = 'block';

    // Auto-hide após 10 segundos
    setTimeout(() => {
        closeCreditCardNotification();
    }, 10000);
}

// Fecha notificação de reset
function closeCreditCardNotification() {
    const notification = document.getElementById('creditCardResetNotification');
    if (notification) {
        notification.style.display = 'none';
    }
}

// Reset manual de cartão de crédito
async function resetCreditCard(accountId) {
    if (!confirm('Deseja restaurar o limite deste cartão de crédito para o valor total?')) {
        return;
    }

    try {
        const response = await apiCall(`/api/accounts/${accountId}/reset`, {
            method: 'POST'
        });

        if (response && response.card) {
            showNotification(`Limite do cartão "${response.card.name}" restaurado para R$ ${formatCurrency(response.card.credit_limit)}!`, 'success');
            await loadAccounts();
            updateOverview();
        }
    } catch (error) {
        console.error('Erro ao resetar cartão:', error);
        showNotification('Erro ao resetar limite do cartão', 'error');
    }
}

// Exibe alertas de cartões próximos do fechamento
function displayCreditCardAlerts() {
    const alertsContainer = document.getElementById('creditCardAlerts');
    if (!alertsContainer) return;

    const today = new Date().getDate();
    const creditCards = accounts.filter(a => a.type === 'cartao');
    const alerts = [];

    creditCards.forEach(card => {
        const closingDay = card.closing_day || 1;
        let daysUntilClosing;

        if (closingDay >= today) {
            daysUntilClosing = closingDay - today;
        } else {
            // Próximo mês
            const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
            daysUntilClosing = (daysInMonth - today) + closingDay;
        }

        const usedLimit = (card.credit_limit || 0) - (card.balance || 0);
        const usagePercentage = card.credit_limit > 0 ? (usedLimit / card.credit_limit) * 100 : 0;

        // Alerta se fechamento próximo (3 dias ou menos)
        if (daysUntilClosing <= 3 && daysUntilClosing >= 0) {
            alerts.push({
                type: 'warning',
                icon: '📅',
                message: `Cartão "${card.name}" fecha em ${daysUntilClosing} dia(s)! Fatura: R$ ${formatCurrency(usedLimit)}`
            });
        }

        // Alerta se limite está alto (80% ou mais)
        if (usagePercentage >= 80) {
            alerts.push({
                type: usagePercentage >= 95 ? 'danger' : 'warning',
                icon: '💳',
                message: `Cartão "${card.name}" está com ${usagePercentage.toFixed(1)}% do limite utilizado!`
            });
        }
    });

    if (alerts.length > 0) {
        alertsContainer.style.display = 'block';
        alertsContainer.innerHTML = alerts.map(alert => `
            <div class="credit-card-alert ${alert.type}">
                <span class="alert-icon">${alert.icon}</span>
                <span class="alert-message">${alert.message}</span>
            </div>
        `).join('');
    } else {
        alertsContainer.style.display = 'none';
    }
}

function initializeEventListeners() {
    // Logout
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // ── Sidebar collapse (desktop) ─────────────────────────────────────────
    initializeSidebarCollapse();

    // ── User avatar (initials) ─────────────────────────────────────────────
    initializeUserAvatar();

    // ── Category chart list/pie toggle ─────────────────────────────────────
    initializeCategoryViewToggle();

    // ── Evolução Mensal: alternância 6M / 12M ───────────────────────────────
    initializeTrendRangeToggle();

    // ── Botão "+ Novo lançamento" da topbar ──────────────────────────────────
    initializeQuickAddMenu();

    // ── Mobile navigation ──────────────────────────────────────────────────
    // Sidebar toggle (hamburger button in header)
    const menuToggle = document.getElementById('menuToggle');
    if (menuToggle) menuToggle.addEventListener('click', toggleSidebar);

    // Theme toggle (mobile header button mirrors sidebar button)
    const themeToggleMobile = document.getElementById('themeToggleMobile');
    if (themeToggleMobile) themeToggleMobile.addEventListener('click', toggleTheme);

    // Import CSV/Excel
    const importBtn = document.getElementById('importBtn');
    const importFile = document.getElementById('importFile');
    if (importBtn && importFile) {
        importBtn.addEventListener('click', () => {
            const select = document.getElementById('importAccountSelect');
            if (select && !select.value) {
                showNotification('Selecione a conta de destino antes de importar.', 'warning');
                return;
            }
            importFile.click();
        });
        importFile.addEventListener('change', handleImport);
    }

    // Bottom nav buttons
    document.querySelectorAll('.bottom-nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = btn.dataset.page;
            if (page === 'more') {
                toggleSidebar(); // "Mais" opens sidebar with all pages
            } else {
                navigateToPage(page);
            }
        });
    });

    // Close sidebar when clicking outside (overlay click already handled inline)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSidebar();
    });

    // Navigation (sidebar items)
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            navigateToPage(page);
            closeSidebar(); // auto-close on mobile after navigation
        });
    });

    // Overview account selector
    const overviewSelectedAccount = document.getElementById('overviewSelectedAccount');
    if (overviewSelectedAccount) {
        overviewSelectedAccount.addEventListener('change', onOverviewAccountSelectionChanged);
    }

    // Income events
    document.getElementById('addIncomeBtn').addEventListener('click', () => openIncomeModal());
    document.getElementById('incomeForm').addEventListener('submit', saveIncome);
    document.getElementById('incomeMonthFilter').addEventListener('change', filterIncomes);
    document.getElementById('incomeAccountFilter').addEventListener('change', filterIncomes);
    document.getElementById('selectedAccount').addEventListener('change', onAccountSelectionChanged);

    // Expense events
    document.getElementById('addExpenseBtn').addEventListener('click', () => openExpenseModal());
    document.getElementById('expenseForm').addEventListener('submit', saveExpense);
    document.getElementById('expenseMonthFilter').addEventListener('change', filterExpenses);
    document.getElementById('expenseCategoryFilter').addEventListener('change', filterExpenses);
    document.getElementById('expenseAccountFilter').addEventListener('change', filterExpenses);
    document.getElementById('expenseSearchFilter').addEventListener('input', filterExpenses);
    document.getElementById('clearExpenseFilters').addEventListener('click', clearExpenseFilters);

    // Budget events
    document.getElementById('addBudgetBtn').addEventListener('click', () => openBudgetModal());
    document.getElementById('budgetForm').addEventListener('submit', saveBudget);
    document.getElementById('budgetMonthFilter').addEventListener('change', filterBudgets);

    // Account events
    document.getElementById('addAccountBtn').addEventListener('click', () => openAccountModal());
    document.getElementById('accountForm').addEventListener('submit', saveAccount);

    // Goal events — delegated to goals.js to avoid duplicate listeners
    if (typeof initializeGoalEventListeners === 'function') {
        initializeGoalEventListeners();
    }

    // Category events
    document.getElementById('addCategoryBtn').addEventListener('click', () => openCategoryModal());
    document.getElementById('categoryForm').addEventListener('submit', saveCategory);

    // Comparison
    document.getElementById('compareBtn').addEventListener('click', compareMonths);

    // Modal close
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', () => {
            closeAllModals();
        });
    });

    // Close modal on outside click
    window.addEventListener('click', (event) => {
        if (event.target.classList.contains('modal')) {
            closeAllModals();
        }
    });
}

// Navigation
function navigateToPage(page) {
    // Update active sidebar nav item
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (activeNav) activeNav.classList.add('active');

    // Update active bottom nav item
    document.querySelectorAll('.bottom-nav-item').forEach(btn => btn.classList.remove('active'));
    const activeBn = document.querySelector(`.bottom-nav-item[data-page="${page}"]`);
    if (activeBn) activeBn.classList.add('active');

    // Update active page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pageEl = document.getElementById(`${page}-page`);
    if (pageEl) pageEl.classList.add('active');

    // Update page title
    const titles = {
        'overview':   'Visão Geral',
        'incomes':    'Receitas',
        'expenses':   'Despesas',
        'budgets':    'Orçamentos',
        'accounts':   'Contas',
        'goals':      'Metas',
        'categories': 'Categorias',
        'reports':    'Relatórios'
    };
    document.getElementById('pageTitle').textContent = titles[page] || page;

    // Load page-specific data
    if (page === 'categories') displayCategories();

    // Scroll page content to top on navigation
    const pageContent = document.querySelector('.page-content');
    if (pageContent) pageContent.scrollTop = 0;
}

// ── Mobile sidebar helpers ────────────────────────────────────────────────────
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const isOpen  = sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
}

function closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
}

// ── Sidebar collapse (desktop "recolher para ícones") ──────────────────────
function initializeSidebarCollapse() {
    const app = document.getElementById('app');
    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    const expandBtn = document.getElementById('sidebarExpandBtn');
    if (!app || !collapseBtn) return;

    if (localStorage.getItem('sidebarCollapsed') === 'true') {
        app.classList.add('sidebar-collapsed');
    }

    const toggleCollapse = () => {
        const collapsed = app.classList.toggle('sidebar-collapsed');
        localStorage.setItem('sidebarCollapsed', collapsed);
    };

    collapseBtn.addEventListener('click', toggleCollapse);
    if (expandBtn) expandBtn.addEventListener('click', toggleCollapse);
}

// ── Avatar com iniciais do usuário ──────────────────────────────────────────
function initializeUserAvatar() {
    const avatar = document.getElementById('userAvatar');
    if (!avatar) return;
    const name = (currentUser && currentUser.name) ? String(currentUser.name).trim() : '';
    const initials = name
        ? name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
        : 'U';
    avatar.textContent = initials;
}

// ── Toggle lista/pizza — "Gastos por Categoria" ─────────────────────────────
function initializeCategoryViewToggle() {
    const pieBtn = document.getElementById('catViewPieBtn');
    const listBtn = document.getElementById('catViewListBtn');
    const canvas = document.getElementById('categoryPieChart');
    const listView = document.getElementById('categoryListView');
    if (!pieBtn || !listBtn || !canvas || !listView) return;

    pieBtn.addEventListener('click', () => {
        pieBtn.classList.add('active');
        listBtn.classList.remove('active');
        listView.style.display = 'none';
        canvas.style.display = 'block';
    });

    listBtn.addEventListener('click', () => {
        listBtn.classList.add('active');
        pieBtn.classList.remove('active');
        canvas.style.display = 'none';
        listView.style.display = 'flex';
        renderCategoryListView();
    });
}

// Lê os dados já calculados do gráfico de pizza (charts.categoryPie) e
// renderiza a mesma informação em formato de lista com barras de proporção.
function renderCategoryListView() {
    const listView = document.getElementById('categoryListView');
    if (!listView || !charts.categoryPie) return;

    const { labels, datasets } = charts.categoryPie.data;
    const values = (datasets && datasets[0] && datasets[0].data) || [];
    const colors = (datasets && datasets[0] && datasets[0].backgroundColor) || [];

    if (!labels || labels.length === 0) {
        listView.innerHTML = '<div class="category-list-empty">Nenhum gasto registrado neste mês.</div>';
        return;
    }

    const total = values.reduce((sum, v) => sum + (v || 0), 0) || 1;

    listView.innerHTML = labels.map((label, i) => {
        const value = values[i] || 0;
        const pct = Math.round((value / total) * 100);
        const color = colors[i] || 'var(--accent)';
        return `
            <div class="category-list-row">
                <span class="cat-dot" style="background:${color}"></span>
                <div class="cat-list-info">
                    <div class="cat-list-top">
                        <span>${label}</span>
                        <span>${formatCurrency(value)} · ${pct}%</span>
                    </div>
                    <div class="cat-bar-track">
                        <div class="cat-bar-fill" style="width:${pct}%;background:${color}"></div>
                    </div>
                </div>
            </div>`;
    }).join('');
}

// ── Evolução Mensal: alternância 6M / 12M ───────────────────────────────────
function initializeTrendRangeToggle() {
    const btn6 = document.getElementById('trendRange6m');
    const btn12 = document.getElementById('trendRange12m');
    if (!btn6 || !btn12) return;

    const setRange = (months, activeBtn, inactiveBtn) => {
        trendChartMonths = months;
        activeBtn.classList.add('active');
        inactiveBtn.classList.remove('active');
        updateMonthlyTrendChart();
    };

    btn6.addEventListener('click', () => setRange(6, btn6, btn12));
    btn12.addEventListener('click', () => setRange(12, btn12, btn6));
}

// ── Botão "+ Novo lançamento" da topbar (reaproveita os modais já existentes) ─
function initializeQuickAddMenu() {
    const btn = document.getElementById('quickAddBtn');
    const menu = document.getElementById('quickAddMenu');
    const incomeOption = document.getElementById('quickAddIncome');
    const expenseOption = document.getElementById('quickAddExpense');
    if (!btn || !menu) return;

    const closeMenu = () => { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
    const toggleMenu = (e) => {
        e.stopPropagation();
        const isOpen = menu.classList.toggle('open');
        btn.setAttribute('aria-expanded', String(isOpen));
    };

    btn.addEventListener('click', toggleMenu);
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target) && e.target !== btn) closeMenu();
    });

    if (incomeOption) incomeOption.addEventListener('click', () => { closeMenu(); openIncomeModal(); });
    if (expenseOption) expenseOption.addEventListener('click', () => { closeMenu(); openExpenseModal(); });
}


// API Functions
// Controla se já tentamos renovar o token nesta sessão (evita loop)
let _tokenRefreshInProgress = false;

async function apiCall(endpoint, options = {}) {
    const token = localStorage.getItem('token');

    const config = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        ...options
    };

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, config);

        if (response.status === 401) {
            // Tenta renovar o token silenciosamente antes de deslogar
            if (!_tokenRefreshInProgress && endpoint !== '/api/auth/refresh') {
                _tokenRefreshInProgress = true;
                try {
                    const refreshResp = await fetch(`${API_BASE}/api/auth/refresh`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        }
                    });
                    if (refreshResp.ok) {
                        const refreshData = await refreshResp.json();
                        localStorage.setItem('token', refreshData.token);
                        _tokenRefreshInProgress = false;
                        // Retenta a requisição original com o novo token
                        return apiCall(endpoint, options);
                    }
                } catch (_) {}
                _tokenRefreshInProgress = false;
            }
            // Refresh falhou — redireciona para login
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login.html';
            return;
        }

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Erro na requisição');
        }

        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// Load Data Functions
async function loadAllData() {
    try {
        await Promise.all([
            loadCategories(),
            loadTransactions(),
            loadIncomes(),
            loadBudgets(),
            loadAccounts(),
            loadGoals(),
            loadTransfers()
        ]);

        // FORÇAR ATUALIZAÇÃO DE TODAS AS LISTAS APÓS CARREGAR TODOS OS DADOS
        await updateAllDisplays();
    } catch (error) {
        console.error('Erro ao carregar dados:', error);
    }
}

async function updateAllDisplays() {
    // Aguardar um pequeno delay para garantir que todos os dados foram processados
    await new Promise(resolve => setTimeout(resolve, 100));

    // Diagnóstico - verificar se os dados foram carregados
    console.log('🔄 Atualizando displays...', {
        transactions: transactions.length,
        categories: categories.length,
        accounts: accounts.length,
        budgets: budgets.length
    });

    // Atualizar todas as displays na ordem correta
    displayExpenses();
    displayIncomes();
    displayBudgets();
    displayAccounts();
    displayGoals();

    // Atualizar todos os seletores e resumos
    updateCategorySelects();
    updateAccountSelects();
    updateIncomeAccountSelects();
    updateOverviewAccountSelect();
    updateAccountBalances();
    updateAccountSummary();
    updateOverviewAccountSummary();
    updateOverview();

    // Exibir alertas de cartões de crédito
    displayCreditCardAlerts();

    console.log('✅ Displays atualizados com sucesso');
}

// Função de debug para verificar se os dados estão sendo carregados
function debugDataLoading() {
    console.log('🔍 Estado dos dados:', {
        'Transações': transactions.length,
        'Categorias': categories.length,
        'Contas': accounts.length,
        'Orçamentos': budgets.length,
        'Receitas': incomes.length,
        'Metas': goals.length
    });
}

async function loadCategories() {
    try {
        const data = await apiCall('/api/categories');
        categories = data.categories || [];
        updateCategorySelects();
    } catch (error) {
        console.error('Erro ao carregar categorias:', error);
    }
}

async function loadTransactions() {
    try {
        const data = await apiCall('/api/transactions');
        transactions = data.transactions || [];
        // Remover displayExpenses() aqui - será chamado após todos os dados carregarem
    } catch (error) {
        console.error('Erro ao carregar transações:', error);
    }
}

async function loadIncomes() {
    try {
        const data = await apiCall('/api/incomes');
        incomes = data.incomes || [];

        // Popular selects de conta
        updateIncomeAccountSelects();

        displayIncomes();
        updateAccountSummary(); // Atualiza resumo se houver conta selecionada
    } catch (error) {
        console.error('Erro ao carregar receitas:', error);
    }
}

// Atualizar selects de conta na página de receitas
function updateIncomeAccountSelects() {
    const selects = ['incomeAccountFilter', 'selectedAccount'];

    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;

        // Manter valor atual
        const currentValue = select.value;

        // Limpar opções (exceto a primeira)
        while (select.children.length > 1) {
            select.removeChild(select.lastChild);
        }

        // Adicionar contas disponíveis
        accounts.forEach(account => {
            const option = document.createElement('option');
            option.value = account._id;
            option.textContent = account.name;
            select.appendChild(option);
        });

        // Restaurar valor selecionado
        select.value = currentValue;
    });
}

async function loadBudgets() {
    try {
        const data = await apiCall('/api/budgets');
        budgets = data.budgets || [];
        displayBudgets();
    } catch (error) {
        console.error('Erro ao carregar orçamentos:', error);
    }
}

async function loadAccounts() {
    try {
        const data = await apiCall('/api/accounts');
        accounts = data.accounts || [];
        // O saldo retornado pelo backend já é o correto (inclui receitas, despesas e transferências)
        // NÃO recalcular no frontend para evitar sobrescrever valores corretos
        updateAccountSelects();
        updateIncomeAccountSelects(); // Popular selects específicos de receitas
        updateOverviewAccountSelect(); // Popular select da overview
        displayAccounts();
        updateAccountSummary(); // Atualizar resumo se houver conta selecionada
        updateOverviewAccountSummary(); // Atualizar resumo da overview
        displayCreditCardAlerts(); // Atualizar alertas de cartões
    } catch (error) {
        console.error('Erro ao carregar contas:', error);
    }
}

// Função para calcular e atualizar saldos automáticos das contas
function updateAccountBalances() {
    accounts.forEach(account => {
        if (account._id) {
            // Para cartões de crédito, o saldo é gerenciado pelo backend - NÃO recalcular!
            if (account.type === 'cartao') {
                console.log(`ℹ️ Pulando recalculo para cartão de crédito: ${escapeHtml(account.name)}`);
                const balanceElement = document.querySelector(`[data-account-id="${account._id}"] .account-balance`);
                if (balanceElement) {
                    balanceElement.textContent = `R$ ${formatCurrency(account.balance || 0)}`;
                }
                return;
            }

            // Busca receitas vinculadas a esta conta
            const accountIncomes = incomes.filter(income => income.account_id === account._id);
            const totalIncomes = accountIncomes.reduce((sum, income) => sum + (parseFloat(income.amount) || 0), 0);

            // Busca transações vinculadas a esta conta
            const accountTransactions = transactions.filter(transaction => transaction.account_id === account._id);
            const totalTransactionIncomes = accountTransactions.reduce((sum, t) => sum + (parseFloat(t.income) || 0), 0);
            const totalTransactionExpenses = accountTransactions.reduce((sum, t) => sum + (parseFloat(t.expense) || 0), 0);

            // Inclui transferências no cálculo do saldo
            // Entradas: transferências recebidas (to_account_id === account._id)
            const transfersIn = transfers.filter(t => t.to_account_id === account._id);
            const totalTransfersIn = transfersIn.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);

            // Saídas: transferências enviadas (from_account_id === account._id)
            const transfersOut = transfers.filter(t => t.from_account_id === account._id);
            const totalTransfersOut = transfersOut.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);

            // Calcula o saldo total incluindo transferências
            const calculatedBalance = totalIncomes + totalTransactionIncomes - totalTransactionExpenses + totalTransfersIn - totalTransfersOut;

            // ATUALIZA o objeto account para que o saldo total seja calculado corretamente
            account.balance = calculatedBalance;

            // Atualiza visualmente o saldo na interface
            const balanceElement = document.querySelector(`[data-account-id="${account._id}"] .account-balance`);
            if (balanceElement) {
                balanceElement.textContent = `R$ ${formatCurrency(calculatedBalance)}`;

                balanceElement.classList.remove('positive', 'negative', 'zero');
                if (calculatedBalance > 0) {
                    balanceElement.classList.add('positive');
                } else if (calculatedBalance < 0) {
                    balanceElement.classList.add('negative');
                } else {
                    balanceElement.classList.add('zero');
                }
            }
        }
    });

    // Atualizar o saldo total na overview após recalcular todos os saldos
    updateTotalBalanceInOverview();
}

// Função para recalcular todos os saldos das contas no backend
async function recalculateAllBalances() {
    try {
        // 1. Chamar a API para forçar o recálculo no servidor
        await apiCall('/api/accounts/recalculate', { method: 'POST' });

        // 2. Buscar dados atualizados do servidor
        await Promise.all([loadAccounts(), loadTransfers(), loadTransactions(), loadIncomes()]);

        console.log('Saldos das contas recalculados com sucesso!');
        showNotification('Saldos das contas atualizados!', 'success');
    } catch (error) {
        console.error('Erro ao recalcular saldos:', error);
        showNotification('Erro ao atualizar saldos', 'error');
    }
}

// Função para atualizar o saldo total na overview
function updateTotalBalanceInOverview() {
    const totalBalance = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
    const totalBalanceElement = document.getElementById('totalBalance');
    if (totalBalanceElement) {
        totalBalanceElement.textContent = `R$ ${formatCurrency(totalBalance)}`;

        // Adiciona cor baseada no saldo
        totalBalanceElement.style.color = totalBalance >= 0 ? 'var(--success)' : 'var(--danger)';
    }
}




// Update Selects
function updateCategorySelects() {
    const selects = ['expenseCategory', 'budgetCategory', 'expenseCategoryFilter'];

    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            const currentValue = select.value;
            select.innerHTML = selectId.includes('Filter') ?
                '<option value="">Todas as categorias</option>' :
                '<option value="">Selecione uma categoria</option>';

            categories.forEach(category => {
                const option = new Option(category.name, category._id);
                select.add(option);
            });

            if (currentValue) select.value = currentValue;
        }
    });
}

function updateAccountSelects() {
    const selects = ['incomeAccount', 'expenseAccount', 'incomeAccountFilter', 'expenseAccountFilter', 'importAccountSelect'];

    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            const currentValue = select.value;
            select.innerHTML = selectId.includes('Filter') ?
                '<option value="">Todas as contas</option>' :
                selectId === 'importAccountSelect' ?
                '<option value="">Conta para importação...</option>' :
                '<option value="">Selecione uma conta</option>';

            accounts.forEach(account => {
                const option = new Option(account.name, account._id);
                select.add(option);
            });

            if (currentValue) select.value = currentValue;
        }
    });
}

// Overview Functions
function updateOverview() {
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Calculate totals
    const monthIncomes = incomes.filter(i => i.month === currentMonth);
    const monthExpenses = transactions.filter(t => t.month === currentMonth);

    const totalIncome = monthIncomes.reduce((sum, i) => sum + (i.amount || 0), 0);
    const totalExpense = monthExpenses.reduce((sum, t) => sum + (t.expense || 0), 0);
    const totalBalance = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
    const monthSavings = totalIncome - totalExpense;

    // Update UI
    document.getElementById('totalBalance').textContent = `R$ ${formatCurrency(totalBalance)}`;
    document.getElementById('monthIncome').textContent = `R$ ${formatCurrency(totalIncome)}`;
    document.getElementById('monthExpense').textContent = `R$ ${formatCurrency(totalExpense)}`;
    document.getElementById('monthSavings').textContent = `R$ ${formatCurrency(monthSavings)}`;

    // Color savings based on positive/negative
    const savingsElement = document.getElementById('monthSavings');
    savingsElement.style.color = monthSavings >= 0 ? 'var(--success)' : 'var(--danger)';

    // Comparação com o mês anterior (dados reais já carregados, sem novas chamadas à API)
    try { updateKPIDeltas(totalIncome, totalExpense, monthSavings, currentMonth); }
    catch (e) { console.error('Erro ao calcular variação dos KPIs:', e); }

    // Display recent transactions
    try { displayRecentTransactions(); }
    catch (e) { console.error('Erro ao exibir transações recentes:', e); }

    // Update charts
    updateOverviewCharts();
}

// Calcula e exibe a variação percentual dos KPIs em relação ao mês anterior
function updateKPIDeltas(currentIncome, currentExpense, currentSavings, currentMonth) {
    const [year, month] = currentMonth.split('-').map(Number);
    const prevDate = new Date(year, month - 2, 1); // month é 1-indexado no currentMonth
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    const prevIncome = incomes.filter(i => i.month === prevMonth).reduce((s, i) => s + (i.amount || 0), 0);
    const prevExpense = transactions.filter(t => t.month === prevMonth).reduce((s, t) => s + (t.expense || 0), 0);
    const prevSavings = prevIncome - prevExpense;

    renderStatDelta('monthIncomeDelta', currentIncome, prevIncome, true);
    renderStatDelta('monthExpenseDelta', currentExpense, prevExpense, false);
    renderStatDelta('monthSavingsDelta', currentSavings, prevSavings, true);
}

// higherIsBetter: true para receitas/economia (subir é bom), false para despesas (subir é ruim)
function renderStatDelta(elementId, current, previous, higherIsBetter) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (!previous) {
        el.textContent = '';
        el.className = 'stat-delta';
        return;
    }

    const change = ((current - previous) / Math.abs(previous)) * 100;
    const isUp = change >= 0;
    const isGood = higherIsBetter ? isUp : !isUp;
    const arrow = isUp ? '▲' : '▼';

    el.textContent = `${arrow} ${Math.abs(change).toFixed(1)}% vs mês anterior`;
    el.className = `stat-delta ${isGood ? 'up' : 'down'}`;
}

// Ícones por categoria/fonte, para dar identidade visual às transações (igual à demonstração)
const CATEGORY_ICON_MAP = {
    'mercado': '🛒', 'supermercado': '🛒', 'compras': '🛍️',
    'alimentação': '🍔', 'alimentacao': '🍔', 'restaurante': '🍔', 'padaria': '🥐',
    'transporte': '🚗', 'combustível': '⛽', 'combustivel': '⛽', 'uber': '🚕', '99': '🚕',
    'contas': '📄', 'água': '💧', 'agua': '💧', 'energia': '💡', 'luz': '💡', 'internet': '📶', 'telefone': '📱',
    'moradia': '🏠', 'aluguel': '🏠', 'condomínio': '🏠', 'condominio': '🏠',
    'saúde': '💊', 'saude': '💊', 'farmácia': '💊', 'farmacia': '💊',
    'educação': '🎓', 'educacao': '🎓', 'curso': '🎓',
    'lazer': '🎮', 'viagem': '✈️', 'assinatura': '📺', 'streaming': '📺',
    'investimento': '📈', 'presente': '🎁', 'pet': '🐾', 'roupa': '👕', 'vestuário': '👕',
    'beleza': '💄', 'seguro': '🛡️', 'imposto': '🧾'
};

function getTransactionIcon(text, isIncome) {
    const key = (text || '').toLowerCase();
    for (const term in CATEGORY_ICON_MAP) {
        if (key.includes(term)) return CATEGORY_ICON_MAP[term];
    }
    if (isIncome) {
        if (key.includes('salário') || key.includes('salario')) return '💼';
        if (key.includes('freela')) return '💻';
        return '💵';
    }
    return '💸';
}

function displayRecentTransactions() {
    const container = document.getElementById('recentTransactions');
    const recent = [...transactions, ...incomes.map(i => ({...i, isIncome: true}))]
        .sort((a, b) => new Date(b.date || b.created_at) - new Date(a.date || a.created_at))
        .slice(0, 5);

    if (recent.length === 0) {
        container.innerHTML = '<div class="category-list-empty">Nenhuma transação registrada ainda.</div>';
        return;
    }

    container.innerHTML = recent.map(item => {
        const isIncome = item.isIncome;
        const amount = isIncome ? item.amount : item.expense;
        const description = isIncome ? item.source : item.reason;
        const amountClass = isIncome ? 'income' : 'expense';
        const sign = isIncome ? '+' : '-';

        let subtitle = item.date ? formatDate(item.date) : formatMonth(item.month);
        let categoryName = '';
        if (!isIncome && item.category_id) {
            const category = categories.find(c => c._id === item.category_id);
            if (category) { categoryName = category.name; subtitle = `${category.name} · ${subtitle}`; }
        }

        const icon = getTransactionIcon(`${categoryName} ${description}`, isIncome);

        return `
            <div class="transaction-item">
                <div class="transaction-info">
                    <div class="transaction-icon ${amountClass}">${icon}</div>
                    <div class="transaction-details">
                        <h4>${description}</h4>
                        <p>${subtitle}</p>
                    </div>
                </div>
                <div class="transaction-amount ${amountClass}">
                    ${sign} R$ ${formatCurrency(amount)}
                </div>
            </div>
        `;
    }).join('');
}

// Income Functions
// Event handler para mudança na seleção de conta
function onAccountSelectionChanged() {
    const selectedAccountId = document.getElementById('selectedAccount').value;

    // Atualizar o filtro de conta também
    const incomeAccountFilter = document.getElementById('incomeAccountFilter');
    if (selectedAccountId) {
        incomeAccountFilter.value = selectedAccountId;
    }

    // Atualizar resumo e filtros
    updateAccountSummary();
    filterIncomes();
}

// Atualizar resumo da conta selecionada
function updateAccountSummary() {
    const selectedAccountId = document.getElementById('selectedAccount').value;
    const summaryContainer = document.getElementById('accountSummary');

    if (!selectedAccountId) {
        summaryContainer.style.display = 'none';
        return;
    }

    const selectedAccount = accounts.find(a => a._id === selectedAccountId);
    if (!selectedAccount) {
        summaryContainer.style.display = 'none';
        return;
    }

    // Filtrar receitas da conta selecionada
    const accountIncomes = incomes.filter(income => income.account_id === selectedAccountId);

    // Calcular estatísticas
    const totalIncomes = accountIncomes.reduce((sum, income) => sum + income.amount, 0);

    // Mês atual (YYYY-MM)
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    const currentMonthIncomes = accountIncomes
        .filter(income => income.month === currentMonth)
        .reduce((sum, income) => sum + income.amount, 0);

    // Maior receita
    const largestIncome = accountIncomes.length > 0
        ? Math.max(...accountIncomes.map(income => income.amount))
        : 0;

    // Última receita (mais recente)
    const sortedIncomes = [...accountIncomes].sort((a, b) => {
        if (a.month === b.month) return 0;
        return a.month > b.month ? -1 : 1;
    });
    const lastIncome = sortedIncomes.length > 0 ? sortedIncomes[0] : null;

    // Atualizar elementos do resumo
    document.getElementById('summaryAccountName').textContent = selectedAccount.name;
    document.getElementById('summaryAccountType').textContent = getAccountTypeLabel(selectedAccount.type);
    document.getElementById('summaryTotalIncomes').textContent = `R$ ${formatCurrency(totalIncomes)}`;
    document.getElementById('summaryCurrentMonth').textContent = `R$ ${formatCurrency(currentMonthIncomes)}`;
    document.getElementById('summaryLargestIncome').textContent = `R$ ${formatCurrency(largestIncome)}`;
    document.getElementById('summaryLastIncome').textContent = lastIncome
        ? `${formatMonth(lastIncome.month)} - R$ ${formatCurrency(lastIncome.amount)}`
        : '-';

    // Mostrar resumo
    summaryContainer.style.display = 'block';
}

// Helper para obter label do tipo de conta
function getAccountTypeLabel(type) {
    const typeLabels = {
        'corrente': 'Conta Corrente',
        'poupanca': 'Poupança',
        'cartao': 'Cartão de Crédito',
        'investimento': 'Investimento'
    };
    return typeLabels[type] || type;
}

// Overview Account Functions
function onOverviewAccountSelectionChanged() {
    updateOverviewAccountSummary();
    updateOverview(); // Recalcular estatísticas gerais se necessário
}

function updateOverviewAccountSummary() {
    const selectedAccountId = document.getElementById('overviewSelectedAccount').value;
    const summaryContainer = document.getElementById('overviewAccountSummary');

    if (!selectedAccountId) {
        summaryContainer.style.display = 'none';
        return;
    }

    const selectedAccount = accounts.find(a => a._id === selectedAccountId);
    if (!selectedAccount) {
        summaryContainer.style.display = 'none';
        return;
    }

    // Filtrar receitas e transações da conta selecionada
    const accountIncomes = incomes.filter(income => income.account_id === selectedAccountId);
    const accountTransactions = transactions.filter(t => t.account_id === selectedAccountId);

    // Calcular estatísticas
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

    // Receitas do mês atual
    const monthIncomes = accountIncomes
        .filter(income => income.month === currentMonth)
        .reduce((sum, income) => sum + income.amount, 0);

    // Despesas do mês atual (transações com expense > 0)
    const monthExpenses = accountTransactions
        .filter(t => t.month === currentMonth && t.expense > 0)
        .reduce((sum, t) => sum + t.expense, 0);

    // Balanço do mês (receitas - despesas)
    const monthBalance = monthIncomes - monthExpenses;

    // Atualizar elementos do resumo
    document.getElementById('overviewSummaryAccountName').textContent = selectedAccount.name;
    document.getElementById('overviewSummaryAccountType').textContent = getAccountTypeLabel(selectedAccount.type);
    document.getElementById('overviewAccountBalance').textContent = `R$ ${formatCurrency(selectedAccount.balance || 0)}`;
    document.getElementById('overviewAccountIncomes').textContent = `R$ ${formatCurrency(monthIncomes)}`;
    document.getElementById('overviewAccountExpenses').textContent = `R$ ${formatCurrency(monthExpenses)}`;
    document.getElementById('overviewMonthBalance').textContent = `R$ ${formatCurrency(monthBalance)}`;

    // Mostrar resumo
    summaryContainer.style.display = 'block';
}

// Popular select de conta na overview
function updateOverviewAccountSelect() {
    const select = document.getElementById('overviewSelectedAccount');
    if (!select) return;

    // Manter valor atual
    const currentValue = select.value;

    // Limpar opções (exceto a primeira)
    while (select.children.length > 1) {
        select.removeChild(select.lastChild);
    }

    // Adicionar contas disponíveis
    accounts.forEach(account => {
        const option = document.createElement('option');
        option.value = account._id;
        option.textContent = account.name;
        select.appendChild(option);
    });

    // Restaurar valor selecionado
    select.value = currentValue;
}

function displayIncomes(filtered = incomes) {
    const tbody = document.querySelector('#incomesTable tbody');

    // Se há conta selecionada, destacar apenas suas receitas
    const selectedAccountId = document.getElementById('selectedAccount').value;
    let displayIncomes = filtered;

    if (selectedAccountId) {
        displayIncomes = filtered.filter(income => income.account_id === selectedAccountId);
    }

    tbody.innerHTML = displayIncomes.map(income => {
        const account = accounts.find(a => a._id === income.account_id);
        const accountName = account ? account.name : '-';
        const isSelectedAccount = income.account_id === selectedAccountId;
        const rowClass = isSelectedAccount ? 'selected-account-income' : '';

        return `
            <tr class="${rowClass}">
                <td data-label="Mês">${formatMonth(income.month)}</td>
                <td data-label="Data">${formatDate(income.date)}</td>
                <td data-label="Fonte">${escapeHtml(income.source)}</td>
                <td data-label="Valor">R$ ${formatCurrency(income.amount)}</td>
                <td data-label="Conta">${escapeHtml(accountName)}</td>
                <td data-label="Ações" style="gap:.5rem;flex-wrap:wrap;">
                    <button onclick="editIncome('${income._id}')" class="btn-secondary btn-sm">Editar</button>
                    <button onclick="deleteIncome('${income._id}')" class="btn-danger btn-sm">Excluir</button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterIncomes() {
    const monthFilter = document.getElementById('incomeMonthFilter').value;
    const accountFilter = document.getElementById('incomeAccountFilter').value;
    const selectedAccount = document.getElementById('selectedAccount').value;

    let filtered = incomes.filter(income => {
        const matchesMonth = !monthFilter || income.month === monthFilter;
        const matchesAccount = !accountFilter || income.account_id === accountFilter;

        // Se há conta selecionada, dar prioridade a ela
        if (selectedAccount) {
            return matchesMonth && income.account_id === selectedAccount;
        }

        return matchesMonth && matchesAccount;
    });

    displayIncomes(filtered);
}

function openIncomeModal(income = null) {
    const modal = document.getElementById('incomeModal');
    const form = document.getElementById('incomeForm');

    form.reset();

    if (income) {
        document.getElementById('incomeModalTitle').textContent = 'Editar Receita';
        document.getElementById('incomeId').value = income._id;
        document.getElementById('incomeMonth').value = income.month;
        document.getElementById('incomeDate').value = income.date || '';
        document.getElementById('incomeSource').value = income.source;
        document.getElementById('incomeAmount').value = income.amount;
        document.getElementById('incomeAccount').value = income.account_id || '';
    } else {
        document.getElementById('incomeModalTitle').textContent = 'Nova Receita';
        const now = new Date();
        document.getElementById('incomeMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        document.getElementById('incomeDate').value = now.toISOString().slice(0, 10);
    }

    modal.style.display = 'block';
}

function closeIncomeModal() {
    document.getElementById('incomeModal').style.display = 'none';
}

async function saveIncome(event) {
    event.preventDefault();

    const incomeId = document.getElementById('incomeId').value;
    const incomeData = {
        month: document.getElementById('incomeMonth').value,
        date: document.getElementById('incomeDate').value || null,
        source: document.getElementById('incomeSource').value,
        amount: parseFloat(document.getElementById('incomeAmount').value),
        account_id: document.getElementById('incomeAccount').value || null
    };

    try {
        if (incomeId) {
            await apiCall(`/api/incomes/${incomeId}`, {
                method: 'PUT',
                body: JSON.stringify(incomeData)
            });
        } else {
            await apiCall('/api/incomes', {
                method: 'POST',
                body: JSON.stringify(incomeData)
            });
        }

        closeIncomeModal();
        await loadIncomes();
        await loadAccounts(); // Recarrega as contas para atualizar os saldos
        updateOverview();
        showNotification('Receita salva com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao salvar receita:', error);
        showNotification('Erro ao salvar receita', 'error');
    }
}

function editIncome(incomeId) {
    const income = incomes.find(i => i._id === incomeId);
    if (income) {
        openIncomeModal(income);
    }
}

async function deleteIncome(incomeId) {
    if (!confirm('Tem certeza que deseja excluir esta receita?')) {
        return;
    }

    try {
        await apiCall(`/api/incomes/${incomeId}`, {
            method: 'DELETE'
        });

        await loadIncomes();
        await loadAccounts(); // Recarrega as contas para atualizar os saldos
        updateOverview();
        showNotification('Receita excluída com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao excluir receita:', error);
        showNotification('Erro ao excluir receita', 'error');
    }
}

// Expense Functions
function displayExpenses(filtered = transactions) {
    const tbody = document.querySelector('#expensesTable tbody');

    // Aguardar um pouco se os dados ainda não estiverem carregados
    if (categories.length === 0 || accounts.length === 0) {
        console.log('⏳ Aguardando carregamento de dados para exibir despesas...');
        setTimeout(() => displayExpenses(filtered), 200);
        return;
    }

    tbody.innerHTML = filtered.map(transaction => {
        const category = categories.find(c => c._id === transaction.category_id);
        const account = accounts.find(a => a._id === transaction.account_id);
        const categoryName = category ? category.name : '-';
        const accountName = account ? account.name : '-';

        return `
            <tr>
                <td data-label="Mês">${formatMonth(transaction.month)}</td>
                <td data-label="Data">${formatDate(transaction.date)}</td>
                <td data-label="Motivo">${escapeHtml(transaction.reason)}</td>
                <td data-label="Valor">R$ ${formatCurrency(transaction.expense || 0)}</td>
                <td data-label="Categoria">${escapeHtml(categoryName)}</td>
                <td data-label="Conta">${escapeHtml(accountName)}</td>
                <td data-label="Ações" style="gap:.5rem;flex-wrap:wrap;">
                    <button onclick="editExpense('${transaction._id}')" class="btn-secondary btn-sm">Editar</button>
                    <button onclick="deleteExpense('${transaction._id}')" class="btn-danger btn-sm">Excluir</button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterExpenses() {
    const monthFilter = document.getElementById('expenseMonthFilter').value;
    const categoryFilter = document.getElementById('expenseCategoryFilter').value;
    const accountFilter = document.getElementById('expenseAccountFilter').value;
    const searchFilter = document.getElementById('expenseSearchFilter').value.toLowerCase();

    let filtered = transactions.filter(transaction => {
        const matchesMonth = !monthFilter || transaction.month === monthFilter;
        const matchesCategory = !categoryFilter || transaction.category_id === categoryFilter;
        const matchesAccount = !accountFilter || transaction.account_id === accountFilter;
        const matchesSearch = !searchFilter || transaction.reason.toLowerCase().includes(searchFilter);
        return matchesMonth && matchesCategory && matchesAccount && matchesSearch;
    });

    displayExpenses(filtered);
    updateExpenseFilterCount(filtered.length, transactions.length);
}

function clearExpenseFilters() {
    document.getElementById('expenseMonthFilter').value = '';
    document.getElementById('expenseCategoryFilter').value = '';
    document.getElementById('expenseAccountFilter').value = '';
    document.getElementById('expenseSearchFilter').value = '';
    filterExpenses();
}

function updateExpenseFilterCount(filtered, total) {
    const countElement = document.getElementById('expenseFilterCount');
    if (filtered === total) {
        countElement.textContent = `${total} despesas`;
    } else {
        countElement.textContent = `${filtered} de ${total} despesas`;
    }
}

function openExpenseModal(expense = null) {
    const modal = document.getElementById('expenseModal');
    const form = document.getElementById('expenseForm');

    form.reset();

    if (expense) {
        document.getElementById('expenseModalTitle').textContent = 'Editar Despesa';
        document.getElementById('expenseId').value = expense._id;
        document.getElementById('expenseMonth').value = expense.month;
        document.getElementById('expenseDate').value = expense.date || '';
        document.getElementById('expenseReason').value = expense.reason;
        document.getElementById('expenseAmount').value = expense.expense;
        document.getElementById('expenseCategory').value = expense.category_id;
        document.getElementById('expenseAccount').value = expense.account_id || '';
    } else {
        document.getElementById('expenseModalTitle').textContent = 'Nova Despesa';
        const now = new Date();
        document.getElementById('expenseMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        document.getElementById('expenseDate').value = now.toISOString().slice(0, 10);
    }

    modal.style.display = 'block';
}

function closeExpenseModal() {
    document.getElementById('expenseModal').style.display = 'none';
}

async function saveExpense(event) {
    event.preventDefault();

    const expenseId = document.getElementById('expenseId').value;
    const expenseAmount = parseFloat(document.getElementById('expenseAmount').value);
    const expenseMonth = document.getElementById('expenseMonth').value;
    const categoryId = document.getElementById('expenseCategory').value;

    const expenseData = {
        month: expenseMonth,
        date: document.getElementById('expenseDate').value || null,
        reason: document.getElementById('expenseReason').value,
        expense: expenseAmount,
        category_id: categoryId,
        account_id: document.getElementById('expenseAccount').value || null,
        current_value: 0,
        income: 0
    };

    // Verificar orçamento antes de salvar
    const budgetValidation = await checkBudgetLimit(expenseAmount, categoryId, expenseMonth);

    if (budgetValidation.exceedsBudget) {
        const confirmExceed = confirm(
            `⚠️ ATENÇÃO: Esta despesa irá exceder o orçamento!\n\n` +
            `Categoria: ${budgetValidation.categoryName}\n` +
            `Orçamento atual: R$ ${formatCurrency(budgetValidation.budgetAmount)}\n` +
            `Já gasto: R$ ${formatCurrency(budgetValidation.spent)}\n` +
            `Nova despesa: R$ ${formatCurrency(expenseAmount)}\n` +
            `Total após esta despesa: R$ ${formatCurrency(budgetValidation.totalAfter)}\n` +
            `Excedente: R$ ${formatCurrency(budgetValidation.exceededAmount)}\n\n` +
            `Deseja continuar mesmo assim?`
        );

        if (!confirmExceed) {
            showToast('Operação cancelada pelo usuário', 'warning');
            return;
        }

        // Mostrar notificação de alerta
        showToast(`⚠️ Orçamento da categoria "${budgetValidation.categoryName}" será excedido!`, 'warning');
    }

    // Mostrar loading
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Salvando...';

    try {
        if (expenseId) {
            await apiCall(`/api/transactions/${expenseId}`, {
                method: 'PUT',
                body: JSON.stringify(expenseData)
            });
            showToast('Despesa atualizada com sucesso!', 'success');
        } else {
            await apiCall('/api/transactions', {
                method: 'POST',
                body: JSON.stringify(expenseData)
            });
            showToast('Despesa salva com sucesso!', 'success');
        }

        closeExpenseModal();

        // Atualizar dados com refresh automático
        await refreshAllData();

        // Se excedeu o orçamento, mostrar aviso adicional
        if (budgetValidation.exceedsBudget) {
            setTimeout(() => {
                showToast('Revise os orçamentos das categorias em vermelho!', 'error');
            }, 2000);
        }

    } catch (error) {
        console.error('Erro ao salvar despesa:', error);
        showToast('Erro ao salvar despesa: ' + error.message, 'error');
    } finally {
        // Restaurar botão
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

function editExpense(expenseId) {
    const expense = transactions.find(t => t._id === expenseId);
    if (expense) {
        openExpenseModal(expense);
    }
}

async function deleteExpense(expenseId) {
    if (!confirm('Tem certeza que deseja excluir esta despesa?')) {
        return;
    }

    try {
        await apiCall(`/api/transactions/${expenseId}`, {
            method: 'DELETE'
        });

        await loadTransactions();
        await loadAccounts(); // Recarrega as contas para atualizar os saldos
        updateOverview();
        showNotification('Despesa excluída com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao excluir despesa:', error);
        showNotification('Erro ao excluir despesa', 'error');
    }
}

// Budget Validation Functions
async function checkBudgetLimit(newExpenseAmount, categoryId, month) {
    // Encontrar orçamento para a categoria e mês
    const budget = budgets.find(b => b.category_id === categoryId && b.month === month);

    if (!budget) {
        return {
            hasBudget: false,
            exceedsBudget: false,
            categoryName: getCategoryName(categoryId),
            budgetAmount: 0,
            spent: 0,
            totalAfter: newExpenseAmount,
            exceededAmount: 0
        };
    }

    // Calcular valor já gasto (usando campo spent do backend se disponível)
    const spent = budget.spent !== undefined ? budget.spent :
        transactions
            .filter(t => t.month === month && t.category_id === categoryId)
            .reduce((sum, t) => sum + (t.expense || 0), 0);

    const totalAfter = spent + newExpenseAmount;
    const exceededAmount = Math.max(0, totalAfter - budget.amount);
    const exceedsBudget = totalAfter > budget.amount;

    return {
        hasBudget: true,
        exceedsBudget,
        categoryName: getCategoryName(categoryId),
        budgetAmount: budget.amount,
        spent,
        totalAfter,
        exceededAmount,
        percentage: (spent / budget.amount) * 100,
        newPercentage: (totalAfter / budget.amount) * 100
    };
}

function getCategoryName(categoryId) {
    const category = categories.find(c => c._id === categoryId);
    return category ? category.name : 'Categoria não encontrada';
}

// Enhanced Toast Notifications
// showNotification é usada em ~27 pontos do arquivo (reset de cartão, salvar
// receita/despesa/conta/categoria, transferências etc.) mas nunca tinha sido
// definida — só showToast existia. Isso gerava "showNotification is not
// defined" no console toda vez que uma dessas ações rodava. Mantemos as duas
// como sinônimos para não precisar reescrever todas as chamadas.
function showNotification(message, type = 'info', duration = 4000) {
    return showToast(message, type, duration);
}

function showToast(message, type = 'info', duration = 4000) {
    const toastContainer = getOrCreateToastContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };

    toast.innerHTML = `
        <div class="toast-content">
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <span class="toast-message">${message}</span>
            <button class="toast-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;

    toastContainer.appendChild(toast);

    // Auto remove
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = 'toastOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }
    }, duration);
}

function getOrCreateToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(container);
    }
    return container;
}

// Refresh all data automatically
async function refreshAllData() {
    try {
        showToast('Atualizando dados...', 'info', 2000);

        await Promise.all([
            loadCategories(),
            loadTransactions(),
            loadIncomes(),
            loadBudgets(),
            loadAccounts(),
            loadGoals(),
            loadTransfers()
        ]);

        // Usar a função centralizada de atualização
        await updateAllDisplays();

        showToast('Dados atualizados!', 'success', 2000);
    } catch (error) {
        console.error('Erro ao atualizar dados:', error);
        showToast('Erro ao atualizar alguns dados', 'error');
    }
}

// Budget Functions
function displayBudgets(filtered = budgets) {
    const container = document.getElementById('budgetsList');

    // Aguardar um pouco se os dados ainda não estiverem carregados
    if (categories.length === 0 || transactions.length === 0) {
        console.log('⏳ Aguardando carregamento de dados para exibir orçamentos...');
        setTimeout(() => displayBudgets(filtered), 200);
        return;
    }

    if (filtered.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Nenhum orçamento encontrado</p>';
        return;
    }

    container.innerHTML = filtered.map(budget => {
        const category = categories.find(c => c._id === budget.category_id);
        const categoryName = category ? category.name : 'Categoria não encontrada';

        // Usar o campo 'spent' do backend ou calcular se não existir
        const spent = budget.spent !== undefined ? budget.spent :
            transactions
                .filter(t => t.month === budget.month && t.category_id === budget.category_id)
                .reduce((sum, t) => sum + (t.expense || 0), 0);

        const percentage = (spent / budget.amount) * 100;
        const remaining = budget.amount - spent;

        let progressClass = '';
        if (percentage >= 90) progressClass = 'danger';
        else if (percentage >= 70) progressClass = 'warning';

        return `
            <div class="budget-card">
                <div class="budget-header">
                    <h4>${escapeHtml(categoryName)}</h4>
                    <span class="budget-amount">R$ ${formatCurrency(budget.amount)}</span>
                </div>
                <div class="budget-progress">
                    <div class="progress-bar">
                        <div class="progress-fill ${progressClass}" style="width: ${Math.min(percentage, 100)}%"></div>
                    </div>
                    <div class="progress-text">
                        ${percentage.toFixed(1)}% usado - R$ ${formatCurrency(spent)} de R$ ${formatCurrency(budget.amount)}
                        ${remaining < 0 ? `<br><span style="color: var(--danger);">Excedido: R$ ${formatCurrency(Math.abs(remaining))}</span>` : ''}
                    </div>
                </div>
                <div class="budget-actions">
                    <button onclick="editBudget('${budget._id}')" class="btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.875rem;">
                        Editar
                    </button>
                    <button onclick="deleteBudget('${budget._id}')" class="btn-danger">
                        Excluir
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function filterBudgets() {
    const monthFilter = document.getElementById('budgetMonthFilter').value;

    let filtered = budgets;
    if (monthFilter) {
        filtered = budgets.filter(b => b.month === monthFilter);
    }

    displayBudgets(filtered);
}

function openBudgetModal(budget = null) {
    const modal = document.getElementById('budgetModal');
    const form = document.getElementById('budgetForm');

    form.reset();

    if (budget) {
        document.getElementById('budgetModalTitle').textContent = 'Editar Orçamento';
        document.getElementById('budgetId').value = budget._id;
        document.getElementById('budgetMonth').value = budget.month;
        document.getElementById('budgetCategory').value = budget.category_id;
        document.getElementById('budgetAmount').value = budget.amount;
    } else {
        document.getElementById('budgetModalTitle').textContent = 'Novo Orçamento';
        const now = new Date();
        document.getElementById('budgetMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    modal.style.display = 'block';
}

function closeBudgetModal() {
    document.getElementById('budgetModal').style.display = 'none';
}

async function saveBudget(event) {
    event.preventDefault();

    const budgetId = document.getElementById('budgetId').value;
    const budgetData = {
        month: document.getElementById('budgetMonth').value,
        category_id: document.getElementById('budgetCategory').value,
        amount: parseFloat(document.getElementById('budgetAmount').value)
    };

    try {
        if (budgetId) {
            await apiCall(`/api/budgets/${budgetId}`, {
                method: 'PUT',
                body: JSON.stringify(budgetData)
            });
        } else {
            await apiCall('/api/budgets', {
                method: 'POST',
                body: JSON.stringify(budgetData)
            });
        }

        closeBudgetModal();
        await loadBudgets();
    } catch (error) {
        console.error('Erro ao salvar orçamento:', error);
    }
}

function editBudget(budgetId) {
    const budget = budgets.find(b => b._id === budgetId);
    if (budget) {
        openBudgetModal(budget);
    }
}

async function deleteBudget(budgetId) {
    if (!confirm('Tem certeza que deseja excluir este orçamento?')) {
        return;
    }

    try {
        await apiCall(`/api/budgets/${budgetId}`, {
            method: 'DELETE'
        });

        await loadBudgets();
    } catch (error) {
        console.error('Erro ao excluir orçamento:', error);
    }
}

// =====================================================
// ACCOUNT FUNCTIONS (COM SUPORTE A CARTÃO DE CRÉDITO)
// =====================================================

function displayAccounts() {
    const container = document.getElementById('accountsList');

    if (accounts.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Nenhuma conta encontrada</p>';
        return;
    }

    const typeLabels = {
        'corrente': 'Conta Corrente',
        'poupanca': 'Poupança',
        'cartao': 'Cartão de Crédito',
        'investimento': 'Investimento'
    };

    container.innerHTML = accounts.map(account => {
        const isCreditCard = account.type === 'cartao';

        // Informações específicas de cartão de crédito
        let creditCardInfo = '';
        let creditCardActions = '';

        if (isCreditCard) {
            const creditLimit = account.credit_limit || 0;
            const balance = account.balance || 0;
            const usedLimit = creditLimit - balance;
            const usagePercentage = creditLimit > 0 ? (usedLimit / creditLimit) * 100 : 0;
            const closingDay = account.closing_day || 1;

            // Calcular dias até o fechamento
            const today = new Date().getDate();
            let daysUntilClosing;
            if (closingDay >= today) {
                daysUntilClosing = closingDay - today;
            } else {
                const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
                daysUntilClosing = (daysInMonth - today) + closingDay;
            }

            // Determinar classe de progresso
            let progressClass = '';
            if (usagePercentage >= 90) progressClass = 'danger';
            else if (usagePercentage >= 70) progressClass = 'warning';

            creditCardInfo = `
                <div class="credit-card-info-display">
                    <div class="credit-limit-info">
                        <span class="label">Limite Total:</span>
                        <span class="value">R$ ${formatCurrency(creditLimit)}</span>
                    </div>
                    <div class="credit-usage-bar">
                        <div class="progress-bar">
                            <div class="progress-fill ${progressClass}" style="width: ${Math.min(usagePercentage, 100)}%"></div>
                        </div>
                        <div class="usage-text">
                            <span>Usado: R$ ${formatCurrency(usedLimit)} (${usagePercentage.toFixed(1)}%)</span>
                            <span>Disponível: R$ ${formatCurrency(balance)}</span>
                        </div>
                    </div>
                    <div class="closing-day-info">
                        <span class="label">📅 Fechamento:</span>
                        <span class="value">Dia ${closingDay} (${daysUntilClosing === 0 ? 'Hoje!' : `em ${daysUntilClosing} dias`})</span>
                    </div>
                </div>
            `;

            creditCardActions = `
                <button onclick="resetCreditCard('${account._id}')" class="btn-success" title="Restaurar limite do cartão">
                    🔄 Resetar Limite
                </button>
            `;
        }

        return `
            <div class="account-card ${isCreditCard ? 'credit-card-account' : ''}" data-account-id="${account._id}">
                <div class="account-header">
                    <span class="account-type">${typeLabels[account.type] || account.type}</span>
                    ${isCreditCard ? '<span class="credit-card-badge">💳</span>' : ''}
                </div>
                <div class="account-balance ${isCreditCard ? 'credit-card-balance' : ''}">
                    ${isCreditCard ? 'Disponível: ' : ''}R$ ${formatCurrency(account.balance || 0)}
                </div>
                <div class="account-name">${escapeHtml(account.name)}</div>
                ${creditCardInfo}
                <div class="account-actions">
                    <button onclick="editAccount('${account._id}')" class="btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.875rem;">
                        Editar
                    </button>
                    ${creditCardActions}
                    <button onclick="deleteAccount('${account._id}')" class="btn-danger">
                        Excluir
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function openAccountModal(account = null) {
    const modal = document.getElementById('accountModal');
    const form = document.getElementById('accountForm');

    form.reset();

    // Inicializar campos de cartão de crédito
    initializeClosingDaySelect();

    if (account) {
        document.getElementById('accountModalTitle').textContent = 'Editar Conta';
        document.getElementById('accountId').value = account._id;
        document.getElementById('accountName').value = account.name;
        document.getElementById('accountType').value = account.type;

        // Arredonda para 2 casas antes de exibir: o saldo guardado pode ter
        // resíduo de ponto flutuante quase-zero (ex: 1.27e-11) que aparecia
        // em notação científica no campo. Editar esta conta SALVA de volta
        // o valor deste campo como o saldo atual — por isso o rótulo do
        // modal também é ajustado pra "Saldo Atual" ao editar (não é um
        // "saldo inicial" isolado, é o saldo em uso agora).
        const currentBalance = Math.round((account.balance || 0) * 100) / 100;
        document.getElementById('accountBalance').value = currentBalance === 0 ? 0 : currentBalance;

        const balanceLabel = document.querySelector('label[for="accountBalance"]');
        if (balanceLabel) balanceLabel.textContent = 'Saldo Atual (R$):';

        // Campos de cartão de crédito
        if (account.type === 'cartao') {
            document.getElementById('accountCreditLimit').value = account.credit_limit || 0;
            document.getElementById('accountClosingDay').value = account.closing_day || 1;
        }
    } else {
        document.getElementById('accountModalTitle').textContent = 'Nova Conta';
        const balanceLabel = document.querySelector('label[for="accountBalance"]');
        if (balanceLabel) balanceLabel.textContent = 'Saldo Inicial (R$):';
    }

    // Atualizar visibilidade dos campos
    toggleCreditCardFields();

    modal.style.display = 'block';
}

function closeAccountModal() {
    document.getElementById('accountModal').style.display = 'none';
}

async function saveAccount(event) {
    event.preventDefault();

    const accountId = document.getElementById('accountId').value;
    const accountType = document.getElementById('accountType').value;

    const accountData = {
        name: document.getElementById('accountName').value,
        type: accountType
    };

    // Adicionar campos específicos baseado no tipo
    if (accountType === 'cartao') {
        const creditLimit = parseFloat(document.getElementById('accountCreditLimit').value) || 0;
        const closingDay = parseInt(document.getElementById('accountClosingDay').value) || 1;

        accountData.credit_limit = creditLimit;
        accountData.closing_day = closingDay;
        accountData.balance = creditLimit; // Saldo inicial = limite
    } else {
        accountData.balance = Math.round((parseFloat(document.getElementById('accountBalance').value) || 0) * 100) / 100;
    }

    try {
        if (accountId) {
            await apiCall(`/api/accounts/${accountId}`, {
                method: 'PUT',
                body: JSON.stringify(accountData)
            });
            showNotification('Conta atualizada com sucesso!', 'success');
        } else {
            await apiCall('/api/accounts', {
                method: 'POST',
                body: JSON.stringify(accountData)
            });
            showNotification('Conta criada com sucesso!', 'success');
        }

        closeAccountModal();
        await loadAccounts();
        updateOverview();
    } catch (error) {
        console.error('Erro ao salvar conta:', error);
        showNotification('Erro ao salvar conta', 'error');
    }
}

function editAccount(accountId) {
    const account = accounts.find(a => a._id === accountId);
    if (account) {
        openAccountModal(account);
    }
}

async function deleteAccount(accountId) {
    if (!confirm('Tem certeza que deseja excluir esta conta?')) {
        return;
    }

    try {
        await apiCall(`/api/accounts/${accountId}`, {
            method: 'DELETE'
        });

        await loadAccounts();
        updateOverview();
        showNotification('Conta excluída com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao excluir conta:', error);
        showNotification('Erro ao excluir conta', 'error');
    }
}












// Category Functions
function displayCategories() {
    const container = document.getElementById('categoriesList');

    if (categories.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Nenhuma categoria encontrada</p>';
        return;
    }

    container.innerHTML = categories.map(category => {
        // Conta quantas transações e orçamentos usam esta categoria
        const transactionsCount = transactions.filter(t => t.category_id === category._id).length;
        const budgetsCount = budgets.filter(b => b.category_id === category._id).length;
        const totalUsage = transactionsCount + budgetsCount;

        return `
            <div class="category-card">
                <div class="category-header">
                    <h4>${escapeHtml(category.name)}</h4>
                    <div class="category-actions">
                        <button onclick="editCategory('${escapeHtml(category._id)}')" class="btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">
                            Editar
                        </button>
                        <button onclick="deleteCategory('${escapeHtml(category._id)}')" class="btn-danger" ${totalUsage > 0 ? 'disabled title="Categoria em uso"' : ''}>
                            Excluir
                        </button>
                    </div>
                </div>
                ${category.description ? `<div class="category-description">${category.description}</div>` : ''}
                <div class="category-usage">
                    <small>
                        📊 Usada em ${transactionsCount} transação${transactionsCount !== 1 ? 'ões' : ''}
                        e ${budgetsCount} orçamento${budgetsCount !== 1 ? 's' : ''}
                    </small>
                </div>
            </div>
        `;
    }).join('');
}

function openCategoryModal(category = null) {
    const modal = document.getElementById('categoryModal');
    const form = document.getElementById('categoryForm');

    form.reset();

    if (category) {
        document.getElementById('categoryModalTitle').textContent = 'Editar Categoria';
        document.getElementById('categoryId').value = category._id;
        document.getElementById('categoryName').value = category.name;
        document.getElementById('categoryDescription').value = category.description || '';
    } else {
        document.getElementById('categoryModalTitle').textContent = 'Nova Categoria';
    }

    modal.style.display = 'block';
}

function closeCategoryModal() {
    document.getElementById('categoryModal').style.display = 'none';
}

async function saveCategory(event) {
    event.preventDefault();

    const categoryId = document.getElementById('categoryId').value;
    const categoryData = {
        name: document.getElementById('categoryName').value,
        description: document.getElementById('categoryDescription').value
    };

    try {
        if (categoryId) {
            await apiCall(`/api/categories/${categoryId}`, {
                method: 'PUT',
                body: JSON.stringify(categoryData)
            });
            showNotification('Categoria atualizada com sucesso!', 'success');
        } else {
            await apiCall('/api/categories', {
                method: 'POST',
                body: JSON.stringify(categoryData)
            });
            showNotification('Categoria criada com sucesso!', 'success');
        }

        await loadCategories();
        displayCategories();
        updateCategorySelects();
        closeCategoryModal();
        updateOverview();
    } catch (error) {
        console.error('Erro ao salvar categoria:', error);
        showNotification(error.message || 'Erro ao salvar categoria', 'error');
    }
}

async function editCategory(categoryId) {
    const category = categories.find(c => c._id === categoryId);
    if (category) {
        openCategoryModal(category);
    }
}

async function deleteCategory(categoryId) {
    if (!confirm('Tem certeza que deseja excluir esta categoria?')) {
        return;
    }

    try {
        await apiCall(`/api/categories/${categoryId}`, {
            method: 'DELETE'
        });

        await loadCategories();
        displayCategories();
        updateCategorySelects();
        showNotification('Categoria excluída com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao excluir categoria:', error);
        showNotification(error.message || 'Erro ao excluir categoria', 'error');
    }
}

// Comparison Functions
async function compareMonths() {
    const month1 = document.getElementById('compareMonth1').value;
    const month2 = document.getElementById('compareMonth2').value;

    if (!month1 || !month2) {
        showToast('Selecione dois meses para comparar', 'warning');
        return;
    }

    // Calculate data for both months
    const data1 = calculateMonthData(month1);
    const data2 = calculateMonthData(month2);

    const container = document.getElementById('comparisonResults');

    const items = [
        { label: 'Receitas', value1: data1.income, value2: data2.income },
        { label: 'Despesas', value1: data1.expenses, value2: data2.expenses },
        { label: 'Economia', value1: data1.savings, value2: data2.savings }
    ];

    container.innerHTML = items.map(item => {
        const diff = item.value2 - item.value1;
        const diffPercent = item.value1 !== 0 ? ((diff / item.value1) * 100).toFixed(1) : 0;
        const isPositive = diff >= 0;

        return `
            <div class="comparison-item">
                <h4>${item.label}</h4>
                <div class="comparison-values">
                    <span>R$ ${formatCurrency(item.value1)}</span>
                    <span>→</span>
                    <span>R$ ${formatCurrency(item.value2)}</span>
                </div>
                <div class="comparison-change ${isPositive ? 'positive' : 'negative'}">
                    ${isPositive ? '↑' : '↓'} R$ ${formatCurrency(Math.abs(diff))} (${Math.abs(diffPercent)}%)
                </div>
            </div>
        `;
    }).join('');
}

function calculateMonthData(month) {
    const monthIncomes = incomes.filter(i => i.month === month);
    const monthExpenses = transactions.filter(t => t.month === month);

    const income = monthIncomes.reduce((sum, i) => sum + (i.amount || 0), 0);
    const expenses = monthExpenses.reduce((sum, t) => sum + (t.expense || 0), 0);
    const savings = income - expenses;

    return { income, expenses, savings };
}

// Plugin próprio (sem dependência externa) para desenhar o % em cada fatia
// de gráficos do tipo doughnut/pie. Qualquer erro interno é engolido para
// nunca quebrar o desenho do gráfico em si.
const percentageLabelsPlugin = {
    id: 'percentageLabels',
    afterDraw(chart) {
        try {
            if (chart.config.type !== 'doughnut' && chart.config.type !== 'pie') return;
            const opts = chart.options.plugins && chart.options.plugins.percentageLabels;
            if (!opts || opts.display === false) return;

            const meta = chart.getDatasetMeta(0);
            if (!meta || !meta.data || meta.data.length === 0) return;

            const dataArr = (chart.data.datasets[0] && chart.data.datasets[0].data) || [];
            const total = dataArr.reduce((sum, v) => sum + (v || 0), 0);
            if (!total) return;

            const { ctx } = chart;
            ctx.save();
            ctx.font = '700 12px Inter, sans-serif';
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            meta.data.forEach((arc, i) => {
                const value = dataArr[i] || 0;
                const pct = (value / total) * 100;
                if (pct < 4) return; // evita poluir fatias muito pequenas
                const pos = arc.tooltipPosition();
                ctx.fillText(pct.toFixed(1).replace('.', ',') + '%', pos.x, pos.y);
            });
            ctx.restore();
        } catch (e) {
            // silencioso: rótulo é decorativo, nunca deve derrubar o gráfico
        }
    }
};
if (typeof Chart !== 'undefined') {
    try { Chart.register(percentageLabelsPlugin); } catch (e) { console.error('Erro ao registrar plugin de rótulos %:', e); }
}

// Charts Functions
function initializeCharts() {
    try { createMonthlyTrendChart(); } catch (e) { console.error('Erro ao criar gráfico Evolução Mensal:', e); }
    try { createCategoryPieChart(); } catch (e) { console.error('Erro ao criar gráfico Gastos por Categoria:', e); }
    try { createAnnualChart(); } catch (e) { console.error('Erro ao criar gráfico Economia Anual:', e); }
    try { createExpenseDistributionChart(); } catch (e) { console.error('Erro ao criar gráfico Distribuição de Despesas:', e); }
}

function createMonthlyTrendChart() {
    const ctx = document.getElementById('monthlyTrendChart');
    if (!ctx) return;

    charts.monthlyTrend = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Receitas',
                    data: [],
                    borderColor: '#16A34A',
                    backgroundColor: 'rgba(22, 163, 74, 0.1)',
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Despesas',
                    data: [],
                    borderColor: '#DC2626',
                    backgroundColor: 'rgba(220, 38, 38, 0.1)',
                    fill: true,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return 'R$ ' + value.toLocaleString('pt-BR');
                        }
                    }
                }
            }
        }
    });
}

function createCategoryPieChart() {
    const ctx = document.getElementById('categoryPieChart');
    if (!ctx) return;

    charts.categoryPie = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: [],
                borderColor: getComputedStyle(document.body).getPropertyValue('--bg-card').trim() || '#fff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right'
                },
                percentageLabels: {}
            }
        }
    });
}

function createAnnualChart() {
    const ctx = document.getElementById('annualChart');
    if (!ctx) return;

    charts.annual = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Economia Mensal',
                data: [],
                backgroundColor: '#2563EB'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return 'R$ ' + value.toLocaleString('pt-BR');
                        }
                    }
                }
            }
        }
    });
}

function createExpenseDistributionChart() {
    const ctx = document.getElementById('expenseDistributionChart');
    if (!ctx) return;

    charts.expenseDistribution = new Chart(ctx.getContext('2d'), {
        type: 'polarArea',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: []
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right'
                }
            }
        }
    });
}

function updateOverviewCharts() {
    try { updateMonthlyTrendChart(); } catch (e) { console.error('Erro ao atualizar gráfico Evolução Mensal:', e); }
    try { updateCategoryPieChart(); } catch (e) { console.error('Erro ao atualizar gráfico Gastos por Categoria:', e); }
    try { updateAnnualChart(); } catch (e) { console.error('Erro ao atualizar gráfico Economia Anual:', e); }
    try { updateExpenseDistributionChart(); } catch (e) { console.error('Erro ao atualizar gráfico Distribuição de Despesas:', e); }
}

let trendChartMonths = 6;

function updateMonthlyTrendChart() {
    if (!charts.monthlyTrend) return;

    const months = [];
    const now = new Date();
    for (let i = trendChartMonths - 1; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    }

    const incomeData = months.map(month => {
        return incomes
            .filter(i => i.month === month)
            .reduce((sum, i) => sum + (i.amount || 0), 0);
    });

    const expenseData = months.map(month => {
        return transactions
            .filter(t => t.month === month)
            .reduce((sum, t) => sum + (t.expense || 0), 0);
    });

    const labels = months.map(month => {
        const [year, m] = month.split('-');
        const date = new Date(year, m - 1);
        return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    });

    charts.monthlyTrend.data.labels = labels;
    charts.monthlyTrend.data.datasets[0].data = incomeData;
    charts.monthlyTrend.data.datasets[1].data = expenseData;
    charts.monthlyTrend.update();
}

function updateCategoryPieChart() {
    if (!charts.categoryPie) return;

    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthExpenses = transactions.filter(t => t.month === currentMonth);

    const categoryData = {};
    monthExpenses.forEach(t => {
        const category = categories.find(c => c._id === t.category_id);
        const categoryName = category ? category.name : 'Outros';
        categoryData[categoryName] = (categoryData[categoryName] || 0) + (t.expense || 0);
    });

    const colors = [
        '#2563EB', '#16A34A', '#F59E0B', '#DC2626',
        '#8B5CF6', '#06B6D4', '#EC4899', '#14B8A6'
    ];

    charts.categoryPie.data.labels = Object.keys(categoryData);
    charts.categoryPie.data.datasets[0].data = Object.values(categoryData);
    charts.categoryPie.data.datasets[0].backgroundColor = colors.slice(0, Object.keys(categoryData).length);
    charts.categoryPie.update();

    // Se a visão em lista estiver ativa, mantém ela sincronizada com os novos dados
    const listView = document.getElementById('categoryListView');
    if (listView && listView.style.display !== 'none') {
        renderCategoryListView();
    }
}

function updateAnnualChart() {
    if (!charts.annual) return;

    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    }

    const savingsData = months.map(month => {
        const income = incomes
            .filter(i => i.month === month)
            .reduce((sum, i) => sum + (i.amount || 0), 0);
        const expense = transactions
            .filter(t => t.month === month)
            .reduce((sum, t) => sum + (t.expense || 0), 0);
        return income - expense;
    });

    const labels = months.map(month => {
        const [year, m] = month.split('-');
        const date = new Date(year, m - 1);
        return date.toLocaleDateString('pt-BR', { month: 'short' });
    });

    charts.annual.data.labels = labels;
    charts.annual.data.datasets[0].data = savingsData;
    charts.annual.update();
}

function updateExpenseDistributionChart() {
    if (!charts.expenseDistribution) return;

    const categoryData = {};
    transactions.forEach(t => {
        const category = categories.find(c => c._id === t.category_id);
        const categoryName = category ? category.name : 'Outros';
        categoryData[categoryName] = (categoryData[categoryName] || 0) + (t.expense || 0);
    });

    const colors = [
        '#2563EB', '#16A34A', '#F59E0B', '#DC2626',
        '#8B5CF6', '#06B6D4', '#EC4899', '#14B8A6'
    ];

    charts.expenseDistribution.data.labels = Object.keys(categoryData);
    charts.expenseDistribution.data.datasets[0].data = Object.values(categoryData);
    charts.expenseDistribution.data.datasets[0].backgroundColor = colors.slice(0, Object.keys(categoryData).length);
    charts.expenseDistribution.update();
}

function updateChartsTheme() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#F3F4F6' : '#111827';
    const gridColor = isDark ? '#232B3D' : '#E5E7EB';

    Object.values(charts).forEach(chart => {
        if (chart && chart.options) {
            if (chart.options.plugins && chart.options.plugins.legend) {
                chart.options.plugins.legend.labels = chart.options.plugins.legend.labels || {};
                chart.options.plugins.legend.labels.color = textColor;
            }

            if (chart.options.scales) {
                ['x', 'y'].forEach(axis => {
                    if (chart.options.scales[axis]) {
                        chart.options.scales[axis].ticks = chart.options.scales[axis].ticks || {};
                        chart.options.scales[axis].ticks.color = textColor;
                        chart.options.scales[axis].grid = chart.options.scales[axis].grid || {};
                        chart.options.scales[axis].grid.color = gridColor;
                    }
                });
            }

            chart.update();
        }
    });
}

// Export Functions
async function exportData(format) {
    try {
        const response = await fetch(`${API_BASE}/api/export/${format}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao exportar dados');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;

        const date = new Date().toISOString().split('T')[0];
        a.download = `financeiro_${date}.${format === 'excel' ? 'xlsx' : format}`;

        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (error) {
        console.error('Erro ao exportar:', error);
        showToast('Erro ao exportar dados', 'error');
    }
}

// Import Functions
async function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const accountSelect = document.getElementById('importAccountSelect');
    const accountId = accountSelect ? accountSelect.value : '';

    if (!accountId) {
        showNotification('Selecione a conta de destino antes de importar.', 'warning');
        event.target.value = '';
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('account_id', accountId);

    try {
        const response = await fetch(`${API_BASE}/api/import`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Erro ao importar dados');
        }

        showNotification(`Importação concluída! ${data.imported} registro(s) importado(s).`, 'success');

        // Recarrega tudo: transações novas + saldo da conta recalculado no backend
        await Promise.all([loadTransactions(), loadAccounts()]);
    } catch (error) {
        console.error('Erro ao importar:', error);
        showNotification(error.message || 'Erro ao importar dados', 'error');
    } finally {
        event.target.value = '';
    }
}

// Utility Functions
function formatCurrency(value) {
    let v = Number(value);
    if (!Number.isFinite(v)) v = 0;      // null/undefined/NaN/Infinity -> 0
    v = Math.round(v * 100) / 100;       // arredonda para centavos ANTES de checar zero
    if (v === 0) v = 0;                  // -0.003 vira -0 depois do round; normaliza pra 0 positivo
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(v);
}

function formatMonth(monthString) {
    const [year, month] = monthString.split('-');
    const date = new Date(year, month - 1);
    return date.toLocaleDateString('pt-BR', {
        year: 'numeric',
        month: 'long'
    });
}

// Formata "YYYY-MM-DD" -> "DD/MM/AAAA". Retorna '-' quando a data não foi informada
// (mantém compatibilidade com lançamentos antigos que só tinham o mês).
function formatDate(dateString) {
    if (!dateString) return '-';
    const [year, month, day] = dateString.split('-');
    if (!year || !month || !day) return '-';
    return `${day}/${month}/${year}`;
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
}

// Auth Functions
function logout() {
    // Parar o keep-alive antes de fazer logout
    keepAliveManager.stop();

    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
}

// =====================================================
// TRANSFERÊNCIA ENTRE CONTAS
// =====================================================

let transfers = [];

async function loadTransfers() {
    try {
        const data = await apiCall('/api/transfers');
        transfers = data.transfers || [];
    } catch (error) {
        console.error('Erro ao carregar transferências:', error);
        transfers = [];
    }
}

function openTransferModal() {
    const modal = document.getElementById('transferModal');
    const fromSelect = document.getElementById('transferFrom');
    const toSelect = document.getElementById('transferTo');
    const dateInput = document.getElementById('transferDate');
    const descInput = document.getElementById('transferDescription');
    const amountInput = document.getElementById('transferAmount');
    const balanceInfo = document.getElementById('transferBalanceInfo');

    // Limpar campos
    fromSelect.innerHTML = '<option value="">Selecione a conta de origem</option>';
    toSelect.innerHTML = '<option value="">Selecione a conta de destino</option>';
    amountInput.value = '';
    descInput.value = '';
    balanceInfo.style.display = 'none';

    // Data padrão: mês atual
    const now = new Date();
    dateInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Preencher selects com contas disponíveis
    const typeLabels = {
        'corrente': 'Conta Corrente',
        'poupanca': 'Poupança',
        'cartao': 'Cartão de Crédito',
        'investimento': 'Investimento'
    };

    accounts.forEach(account => {
        const label = `${escapeHtml(account.name)} (${typeLabels[account.type] || account.type}) — R$ ${formatCurrency(account.balance || 0)}`;
        const optFrom = new Option(label, account._id);
        const optTo = new Option(label, account._id);
        fromSelect.appendChild(optFrom);
        toSelect.appendChild(optTo);
    });

    // Mostrar saldo ao selecionar conta origem
    fromSelect.onchange = function () {
        const selected = accounts.find(a => a._id === this.value);
        if (selected) {
            balanceInfo.style.display = 'block';
            const isCreditCard = selected.type === 'cartao';
            balanceInfo.innerHTML = `
                <span class="transfer-balance-label">
                    ${isCreditCard ? '💳 Limite disponível:' : '💰 Saldo disponível:'}
                    <strong>R$ ${formatCurrency(selected.balance || 0)}</strong>
                </span>
            `;
        } else {
            balanceInfo.style.display = 'none';
        }
    };

    modal.style.display = 'flex';
}

function closeTransferModal() {
    document.getElementById('transferModal').style.display = 'none';
    document.getElementById('transferForm').reset();
    document.getElementById('transferBalanceInfo').style.display = 'none';
}

async function submitTransfer(e) {
    e.preventDefault();

    const fromId = document.getElementById('transferFrom').value;
    const toId = document.getElementById('transferTo').value;
    const amount = parseFloat(document.getElementById('transferAmount').value);
    const date = document.getElementById('transferDate').value;
    const description = document.getElementById('transferDescription').value || 'Transferência entre contas';

    if (!fromId || !toId) {
        showNotification('Selecione as contas de origem e destino.', 'error');
        return;
    }
    if (fromId === toId) {
        showNotification('As contas de origem e destino não podem ser iguais.', 'error');
        return;
    }
    if (!amount || amount <= 0) {
        showNotification('Informe um valor válido para a transferência.', 'error');
        return;
    }

    try {
        const result = await apiCall('/api/transfers', {
            method: 'POST',
            body: JSON.stringify({ from_account_id: fromId, to_account_id: toId, amount, date, description })
        });

        // Atualizar saldos diretamente no array local antes do re-fetch (evita delay visual)
        if (result.new_from_balance !== undefined && result.new_from_balance !== null) {
            const fromAcc = accounts.find(a => a._id === result.from_account_id);
            if (fromAcc) fromAcc.balance = result.new_from_balance;
        }
        if (result.new_to_balance !== undefined && result.new_to_balance !== null) {
            const toAcc = accounts.find(a => a._id === result.to_account_id);
            if (toAcc) toAcc.balance = result.new_to_balance;
        }

        // Atualizar a tela imediatamente com os dados locais
        displayAccounts();
        updateAccountSelects();

        showNotification(result.message || 'Transferência realizada!', 'success');
        closeTransferModal();

        // Re-fetch em background para garantir sincronização
        loadAccounts();
    } catch (error) {
        showNotification(error.message || 'Erro ao realizar transferência.', 'error');
    }
}

async function openTransferHistoryModal() {
    await loadTransfers();

    const modal = document.getElementById('transferHistoryModal');
    const list = document.getElementById('transferHistoryList');

    if (transfers.length === 0) {
        list.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 2rem;">Nenhuma transferência registrada.</p>';
    } else {
        list.innerHTML = transfers.map(t => `
            <div class="transfer-history-item">
                <div class="transfer-history-info">
                    <div class="transfer-history-accounts">
                        <span class="transfer-from">${escapeHtml(t.from_account_name || 'Conta')}</span>
                        <span class="transfer-arrow">→</span>
                        <span class="transfer-to">${escapeHtml(t.to_account_name || 'Conta')}</span>
                    </div>
                    <div class="transfer-history-details">
                        <span class="transfer-description">${escapeHtml(t.description || 'Transferência')}</span>
                        <span class="transfer-date">${t.date || ''}</span>
                    </div>
                </div>
                <div class="transfer-history-right">
                    <span class="transfer-amount">R$ ${formatCurrency(t.amount)}</span>
                    <button onclick="deleteTransfer('${t._id}')" class="btn-danger" title="Estornar transferência" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;">
                        ↩ Estornar
                    </button>
                </div>
            </div>
        `).join('');
    }

    modal.style.display = 'flex';
}

function closeTransferHistoryModal() {
    document.getElementById('transferHistoryModal').style.display = 'none';
}

async function deleteTransfer(transferId) {
    if (!confirm('Deseja estornar esta transferência? Os saldos das contas serão revertidos.')) return;

    try {
        const result = await apiCall(`/api/transfers/${transferId}`, { method: 'DELETE' });
        showNotification(result.message || 'Transferência estornada!', 'success');
        // Re-fetch completo após estorno para garantir saldos corretos
        await loadAccounts();
        displayAccounts();
        updateAccountSelects();
        // Reabrir o histórico já atualizado
        await openTransferHistoryModal();
    } catch (error) {
        showNotification(error.message || 'Erro ao estornar transferência.', 'error');
    }
}

// Registrar event listener do form de transferência
document.addEventListener('DOMContentLoaded', function () {
    const transferForm = document.getElementById('transferForm');
    if (transferForm) {
        transferForm.addEventListener('submit', submitTransfer);
    }
});
