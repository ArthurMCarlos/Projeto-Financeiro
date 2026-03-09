// Global variables
let currentUser = null;
let transactions = [];
let categories = [];
let incomes = [];
let budgets = [];
let accounts = [];
let goals = [];
let charts = {};

// API Base URL
const API_BASE = "https://projeto-financeiro-z2th.onrender.com";

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
        console.warn(`⚠️ KeepAlive: Erro ${this.retryCount}/${this.maxRetries}`);

        if (this.retryCount >= this.maxRetries) {
            console.error('❌ KeepAlive: Máximo de tentativas excedido. Parando keep-alive.');
            this.stop();
            showNotification('Conexão com servidor perdida. Atualize a página.', 'error');
        }
    }
}

// Instância global do KeepAlive Manager
const keepAliveManager = new KeepAliveManager();

// =====================================================
// INICIALIZAÇÃO
// =====================================================

document.addEventListener('DOMContentLoaded', function() {
    // Inicializa o keep-alive
    keepAliveManager.start();

    // Verifica autenticação
    checkAuth();
    
    // Carrega dados iniciais
    loadInitialData();

    // Configura event listeners globais
    setupGlobalEventListeners();

    // Inicializa tooltips
    initializeTooltips();

    // Configura o intervalo de atualização automática (a cada 5 minutos)
    setInterval(() => {
        console.log('🔄 Atualização automática de dados...');
        loadInitialData();
    }, 5 * 60 * 1000); // 5 minutos
});

// Função para verificar autenticação
async function checkAuth() {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');

    if (!token || !userData) {
        console.log('Token ou usuário não encontrado, redirecionando para login...');
        window.location.href = 'index.html';
        return;
    }

    try {
        currentUser = JSON.parse(userData);
        console.log('Usuário autenticado:', currentUser.name);
        updateWelcomeMessage();
    } catch (error) {
        console.error('Erro ao analisar dados do usuário:', error);
        window.location.href = 'index.html';
    }
}

// Função para carregar dados iniciais
async function loadInitialData() {
    try {
        // Carrega dados em paralelo
        await Promise.all([
            loadCategories(),
            loadAccounts(),
            loadTransactions(),
            loadIncomes(),
            loadBudgets(),
            loadGoals()
        ]);

        console.log('✅ Todos os dados carregados com sucesso!');
    } catch (error) {
        console.error('❌ Erro ao carregar dados iniciais:', error);
        showNotification('Erro ao carregar dados. Tente novamente.', 'error');
    }
}

// Função para atualizar mensagem de boas-vindas
function updateWelcomeMessage() {
    const welcomeElement = document.getElementById('welcomeMessage');
    if (welcomeElement && currentUser) {
        welcomeElement.textContent = `Bem-vindo, ${currentUser.name}!`;
    }
}

// Configura event listeners globais
function setupGlobalEventListeners() {
    // Fecha modais ao clicar fora
    window.addEventListener('click', function(event) {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    });

    // Preview de数据 nos inputs de arquivo
    document.addEventListener('change', function(event) {
        if (event.target.type === 'file') {
            const file = event.target.files[0];
            if (file) {
                console.log('Arquivo selecionado:', file.name);
            }
        }
    });
}

// Inicializa tooltips
function initializeTooltips() {
    // Tooltips usando atributos data-tooltip
    const tooltipElements = document.querySelectorAll('[data-tooltip]');
    
    tooltipElements.forEach(element => {
        element.addEventListener('mouseenter', showTooltip);
        element.addEventListener('mouseleave', hideTooltip);
    });
}

function showTooltip(event) {
    const text = event.target.getAttribute('data-tooltip');
    if (!text) return;

    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.textContent = text;
    tooltip.id = 'tooltip';
    
    document.body.appendChild(tooltip);
    
    const rect = event.target.getBoundingClientRect();
    tooltip.style.top = `${rect.top - tooltip.offsetHeight - 10}px`;
    tooltip.style.left = `${rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2)}px`;
}

function hideTooltip() {
    const tooltip = document.getElementById('tooltip');
    if (tooltip) {
        tooltip.remove();
    }
}

// =====================================================
// API HELPER
// =====================================================

async function apiCall(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token || ''}`
        }
    };

    const mergedOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers
        }
    };

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, mergedOptions);
        
        // Trata resposta vazia
        const text = await response.text();
        const data = text ? JSON.parse(text) : {};

        if (!response.ok) {
            throw new Error(data.message || `Erro ${response.status}: ${response.statusText}`);
        }

        console.log(`✅ API call bem-sucedida: ${endpoint}`, data);
        return data;
    } catch (error) {
        console.error(`❌ Erro na API call (${endpoint}):`, error);
        
        if (error.message.includes('Token')) {
            showNotification('Sessão expirada. Faça login novamente.', 'error');
            setTimeout(() => {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                window.location.href = 'index.html';
            }, 2000);
        }
        
        throw error;
    }
}

// =====================================================
// CATEGORIAS
// =====================================================

async function loadCategories() {
    try {
        const data = await apiCall('/api/categories');
        categories = data.categories || [];
        console.log('Categorias carregadas:', categories.length);
    } catch (error) {
        console.error('Erro ao carregar categorias:', error);
    }
}

function getCategoryById(id) {
    return categories.find(cat => cat._id === id);
}

function getCategoryName(id) {
    const category = getCategoryById(id);
    return category ? category.name : 'Sem categoria';
}

function getCategoryColor(id) {
    const category = getCategoryById(id);
    return category ? category.color : '#888';
}

// =====================================================
// CONTAS
// =====================================================

async function loadAccounts() {
    try {
        const data = await apiCall('/api/accounts');
        accounts = data.accounts || [];
        updateAccountSelects();
        updateIncomeAccountSelects(); // Popular selects específicos de receitas
        updateOverviewAccountSelect(); // Popular select da overview
        displayAccounts();
        updateAccountBalances(); // Atualiza o cálculo de saldos automático
        updateAccountSummary(); // Atualizar resumo se houver conta selecionada
        updateOverviewAccountSummary(); // Atualizar resumo da overview
        displayCreditCardAlerts(); // Atualizar alertas de cartões
    } catch (error) {
        console.error('Erro ao carregar contas:', error);
    }
}

// Função CORRIGIDA para atualizar saldos - usa o saldo do servidor
function updateAccountBalances() {
    accounts.forEach(account => {
        if (account._id) {
            // Para cartões de crédito, o saldo é gerenciado pelo backend
            if (account.type === 'cartao') {
                console.log(`ℹ️ Usando saldo do servidor para cartão: ${account.name}`);
                
                // Atualizar visualmente apenas com o valor do servidor
                const balanceElement = document.querySelector(`[data-account-id="${account._id}"] .account-balance`);
                if (balanceElement) {
                    const creditLimit = account.credit_limit || 0;
                    const balance = account.balance || 0;
                    balanceElement.textContent = `R$ ${formatCurrency(balance)}`;
                }
                return;
            }

            // CORREÇÃO PRINCIPAL: Usa o saldo que veio do servidor (account.balance)
            // NÃO recalcula mais a partir das transações
            const currentBalance = account.balance;

            // Atualiza visualmente o saldo na interface usando o valor do servidor
            const balanceElement = document.querySelector(`[data-account-id="${account._id}"] .account-balance`);
            if (balanceElement) {
                balanceElement.textContent = `R$ ${formatCurrency(currentBalance)}`;

                // Adiciona classes CSS para cores baseadas no saldo
                balanceElement.classList.remove('positive', 'negative', 'zero');
                if (currentBalance > 0) {
                    balanceElement.classList.add('positive');
                } else if (currentBalance < 0) {
                    balanceElement.classList.add('negative');
                } else {
                    balanceElement.classList.add('zero');
                }
            }
        }
    });

    // Atualizar o saldo total na overview após atualizar todos os saldos
    updateTotalBalanceInOverview();
    console.log('Saldos das contas atualizados visualmente com base nos dados do servidor!');
}

// Função para recalcular todos os saldos das contas no backend
async function recalculateAllBalances() {
    try {
        // Agora apenas atualiza a visualização usando dados do servidor
        updateAccountBalances();

        console.log('Saldos das contas atualizados automaticamente!');
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
        totalBalanceElement.classList.remove('positive', 'negative', 'zero');
        if (totalBalance > 0) {
            totalBalanceElement.classList.add('positive');
        } else if (totalBalance < 0) {
            totalBalanceElement.classList.add('negative');
        } else {
            totalBalanceElement.classList.add('zero');
        }
    }
}

// Exibe as contas na interface
function displayAccounts() {
    const accountsContainer = document.getElementById('accountsContainer');
    if (!accountsContainer) return;

    accountsContainer.innerHTML = '';

    // Filtra apenas contas normais (exclui cartões de crédito da lista)
    const regularAccounts = accounts.filter(account => account.type !== 'cartao');

    regularAccounts.forEach(account => {
        const accountCard = createAccountCard(account);
        accountsContainer.appendChild(accountCard);
    });

    // Exibe cartões de crédito separadamente
    displayCreditCards();
}

// Cria o card de uma conta
function createAccountCard(account) {
    const div = document.createElement('div');
    div.className = 'account-card';
    div.setAttribute('data-account-id', account._id);

    const balanceClass = account.balance >= 0 ? 'positive' : 'negative';

    div.innerHTML = `
        <div class="account-header">
            <div class="account-info">
                <h3>${account.name}</h3>
                <span class="account-type">${getAccountTypeName(account.type)}</span>
            </div>
            <div class="account-actions">
                <button class="btn-icon" onclick="editAccount('${account._id}')" title="Editar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                <button class="btn-icon danger" onclick="deleteAccount('${account._id}')" title="Excluir">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        </div>
        <div class="account-balance ${balanceClass}">
            R$ ${formatCurrency(account.balance || 0)}
        </div>
        <div class="account-footer">
            <small>Última atualização: ${new Date(account.updatedAt).toLocaleDateString('pt-BR')}</small>
        </div>
    `;

    return div;
}

// Exibe cartões de crédito separadamente
function displayCreditCards() {
    const creditCards = accounts.filter(account => account.type === 'cartao');
    const container = document.getElementById('creditCardsContainer');
    
    if (!container) return;
    
    container.innerHTML = '';
    
    if (creditCards.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    
    creditCards.forEach(card => {
        const cardElement = createCreditCardElement(card);
        container.appendChild(cardElement);
    });
}

// Cria o elemento visual de um cartão de crédito
function createCreditCardElement(card) {
    const div = document.createElement('div');
    div.className = 'credit-card';
    div.setAttribute('data-account-id', card._id);
    
    const balance = card.balance || 0;
    const limit = card.credit_limit || 0;
    const percentage = limit > 0 ? Math.min((Math.abs(balance) / limit) * 100, 100) : 0;
    
    // Determina a cor do cartão baseada no tipo
    const cardColors = {
        'visa': '#1A1F71',
        'mastercard': '#EB001B',
        'amex': '#006FCF',
        'other': '#2D3436'
    };
    const cardColor = cardColors[card.card_brand?.toLowerCase()] || cardColors['other'];
    
    div.innerHTML = `
        <div class="credit-card-header" style="background: ${cardColor}">
            <div class="credit-card-brand">${card.card_brand || 'Cartão'}</div>
            <div class="credit-card-actions">
                <button class="btn-icon" onclick="editAccount('${card._id}')" title="Editar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                <button class="btn-icon danger" onclick="deleteAccount('${card._id}')" title="Excluir">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        </div>
        <div class="credit-card-body">
            <div class="credit-card-name">${card.name}</div>
            <div class="credit-card-balance">
                <span class="label">Fatura atual:</span>
                <span class="value ${balance > 0 ? 'negative' : 'positive'}">R$ ${formatCurrency(balance)}</span>
            </div>
            <div class="credit-card-limit">
                <div class="limit-bar">
                    <div class="limit-percentage" style="width: ${percentage}%"></div>
                </div>
                <span class="limit-text">Limite: R$ ${formatCurrency(limit)} (${percentage.toFixed(1)}%)</span>
            </div>
        </div>
    `;
    
    return div;
}

// Exibe alertas de cartões de crédito
function displayCreditCardAlerts() {
    const creditCards = accounts.filter(account => account.type === 'cartao');
    const alertsContainer = document.getElementById('creditCardAlerts');
    
    if (!alertsContainer) return;
    
    alertsContainer.innerHTML = '';
    
    creditCards.forEach(card => {
        const balance = card.balance || 0;
        const limit = card.credit_limit || 0;
        
        if (limit > 0) {
            const percentage = (Math.abs(balance) / limit) * 100;
            
            if (percentage >= 80) {
                const alertDiv = document.createElement('div');
                alertDiv.className = `alert ${percentage >= 90 ? 'danger' : 'warning'}`;
                alertDiv.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <span><strong>${card.name}</strong>: ${percentage.toFixed(1)}% do limite usado (R$ ${formatCurrency(balance)} de R$ ${formatCurrency(limit)})</span>
                `;
                alertsContainer.appendChild(alertDiv);
            }
        }
    });
}

// Atualiza os selects de contas
function updateAccountSelects() {
    const selects = ['transactionAccount', 'transferFromAccount', 'transferToAccount'];
    
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;
        
        // Preserva a opção selecionada atualmente
        const currentValue = select.value;
        
        // Limpa as opções (exceto a primeira)
        select.innerHTML = '<option value="">Selecione uma conta</option>';
        
        // Adiciona apenas contas normais (não cartões)
        const regularAccounts = accounts.filter(account => account.type !== 'cartao');
        
        regularAccounts.forEach(account => {
            const option = document.createElement('option');
            option.value = account._id;
            option.textContent = `${account.name} (R$ ${formatCurrency(account.balance || 0)})`;
            select.appendChild(option);
        });
        
        // Restaura o valor selecionado se ainda for válido
        if (currentValue && accounts.some(a => a._id === currentValue)) {
            select.value = currentValue;
        }
    });
}

// Atualiza selects específicos de receitas
function updateIncomeAccountSelects() {
    const select = document.getElementById('incomeAccount');
    if (!select) return;
    
    const currentValue = select.value;
    select.innerHTML = '<option value="">Selecione uma conta</option>';
    
    const regularAccounts = accounts.filter(account => account.type !== 'cartao');
    
    regularAccounts.forEach(account => {
        const option = document.createElement('option');
        option.value = account._id;
        option.textContent = `${account.name} (R$ ${formatCurrency(account.balance || 0)})`;
        select.appendChild(option);
    });
    
    if (currentValue && accounts.some(a => a._id === currentValue)) {
        select.value = currentValue;
    }
}

// Atualiza select da overview
function updateOverviewAccountSelect() {
    const select = document.getElementById('overviewAccount');
    if (!select) return;
    
    const currentValue = select.value;
    select.innerHTML = '<option value="all">Todas as contas</option>';
    
    accounts.forEach(account => {
        const option = document.createElement('option');
        option.value = account._id;
        option.textContent = `${account.name} (R$ ${formatCurrency(account.balance || 0)})`;
        select.appendChild(option);
    });
    
    if (currentValue) {
        select.value = currentValue;
    }
}

// Função para abrir o modal de adicionar conta
function openAddAccountModal() {
    document.getElementById('accountModal').style.display = 'block';
    document.getElementById('accountForm').reset();
    document.getElementById('accountId').value = '';
    document.getElementById('accountModalTitle').textContent = 'Nova Conta';
    document.getElementById('creditCardFields').style.display = 'none';
    document.getElementById('accountType').value = 'corrente';
}

// Função para fechar o modal de conta
function closeAccountModal() {
    document.getElementById('accountModal').style.display = 'none';
}

// Função para salvar conta
async function saveAccount() {
    const accountId = document.getElementById('accountId').value;
    const name = document.getElementById('accountName').value;
    const type = document.getElementById('accountType').value;
    const initialBalance = parseFloat(document.getElementById('accountInitialBalance').value) || 0;
    const creditLimit = parseFloat(document.getElementById('creditLimit').value) || 0;
    const cardBrand = document.getElementById('cardBrand').value;

    if (!name) {
        showNotification('Por favor, preencha o nome da conta.', 'error');
        return;
    }

    const accountData = {
        name,
        type,
        initial_balance: initialBalance,
        credit_limit: type === 'cartao' ? creditLimit : 0,
        card_brand: type === 'cartao' ? cardBrand : null
    };

    try {
        if (accountId) {
            // Atualiza conta existente
            await apiCall(`/api/accounts/${accountId}`, {
                method: 'PUT',
                body: JSON.stringify(accountData)
            });
            showNotification('Conta atualizada com sucesso!', 'success');
        } else {
            // Cria nova conta
            await apiCall('/api/accounts', {
                method: 'POST',
                body: JSON.stringify(accountData)
            });
            showNotification('Conta criada com sucesso!', 'success');
        }

        closeAccountModal();
        loadAccounts();
    } catch (error) {
        console.error('Erro ao salvar conta:', error);
        showNotification('Erro ao salvar conta. Tente novamente.', 'error');
    }
}

// Função para editar conta
async function editAccount(accountId) {
    try {
        const account = accounts.find(a => a._id === accountId);
        if (!account) return;

        document.getElementById('accountId').value = account._id;
        document.getElementById('accountName').value = account.name;
        document.getElementById('accountType').value = account.type;
        document.getElementById('accountInitialBalance').value = account.balance || 0;
        
        if (account.type === 'cartao') {
            document.getElementById('creditCardFields').style.display = 'block';
            document.getElementById('creditLimit').value = account.credit_limit || 0;
            document.getElementById('cardBrand').value = account.card_brand || 'visa';
        } else {
            document.getElementById('creditCardFields').style.display = 'none';
        }

        document.getElementById('accountModalTitle').textContent = 'Editar Conta';
        document.getElementById('accountModal').style.display = 'block';
    } catch (error) {
        console.error('Erro ao carregar conta:', error);
        showNotification('Erro ao carregar dados da conta.', 'error');
    }
}

// Função para excluir conta
async function deleteAccount(accountId) {
    if (!confirm('Tem certeza que deseja excluir esta conta? Esta ação não pode ser desfeita.')) {
        return;
    }

    try {
        await apiCall(`/api/accounts/${accountId}`, {
            method: 'DELETE'
        });
        showNotification('Conta excluída com sucesso!', 'success');
        loadAccounts();
    } catch (error) {
        console.error('Erro ao excluir conta:', error);
        showNotification('Erro ao excluir conta. Tente novamente.', 'error');
    }
}

// Mostra/esconde campos de cartão de crédito
function toggleCreditCardFields() {
    const accountType = document.getElementById('accountType').value;
    const creditCardFields = document.getElementById('creditCardFields');
    
    if (accountType === 'cartao') {
        creditCardFields.style.display = 'block';
    } else {
        creditCardFields.style.display = 'none';
    }
}

// Função para obter nome do tipo de conta
function getAccountTypeName(type) {
    const types = {
        'corrente': 'Conta Corrente',
        'poupanca': 'Poupança',
        'investimento': 'Investimento',
        'cartao': 'Cartão de Crédito',
        'dinheiro': 'Dinheiro',
        'outros': 'Outros'
    };
    return types[type] || type;
}

// =====================================================
// TRANSAÇÕES
// =====================================================

async function loadTransactions() {
    try {
        const data = await apiCall('/api/transactions');
        transactions = data.transactions || [];
        displayTransactions();
        updateCharts();
    } catch (error) {
        console.error('Erro ao carregar transações:', error);
    }
}

// Exibe as transações na interface
function displayTransactions() {
    const transactionsContainer = document.getElementById('transactionsContainer');
    if (!transactionsContainer) return;

    // Filtra transações com base na conta selecionada na overview
    const overviewAccountSelect = document.getElementById('overviewAccount');
    const selectedAccount = overviewAccountSelect ? overviewAccountSelect.value : 'all';
    
    let filteredTransactions = transactions;
    if (selectedAccount && selectedAccount !== 'all') {
        filteredTransactions = transactions.filter(t => t.account_id === selectedAccount);
    }

    // Ordena por data (mais recentes primeiro)
    filteredTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Limita a 50 transações mais recentes
    const recentTransactions = filteredTransactions.slice(0, 50);

    transactionsContainer.innerHTML = '';

    if (recentTransactions.length === 0) {
        transactionsContainer.innerHTML = '<p class="no-data">Nenhuma transação encontrada.</p>';
        return;
    }

    recentTransactions.forEach(transaction => {
        const transactionElement = createTransactionElement(transaction);
        transactionsContainer.appendChild(transactionElement);
    });
}

// Cria o elemento visual de uma transação
function createTransactionElement(transaction) {
    const div = document.createElement('div');
    div.className = 'transaction-item';
    
    const isIncome = parseFloat(transaction.income) > 0;
    const amount = isIncome ? parseFloat(transaction.income) : parseFloat(transaction.expense);
    const amountClass = isIncome ? 'income' : 'expense';
    const category = getCategoryById(transaction.category_id);
    const categoryColor = category ? category.color : '#888';
    const categoryName = category ? category.name : 'Sem categoria';

    div.innerHTML = `
        <div class="transaction-icon" style="background-color: ${categoryColor}20; color: ${categoryColor}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="16"></line>
                <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
        </div>
        <div class="transaction-details">
            <div class="transaction-description">${transaction.description || 'Sem descrição'}</div>
            <div class="transaction-meta">
                <span class="transaction-category" style="background-color: ${categoryColor}20; color: ${categoryColor}">${categoryName}</span>
                <span class="transaction-date">${new Date(transaction.date).toLocaleDateString('pt-BR')}</span>
            </div>
        </div>
        <div class="transaction-amount ${amountClass}">
            ${isIncome ? '+' : '-'} R$ ${formatCurrency(amount)}
        </div>
    `;

    return div;
}

// Função para abrir o modal de transação
function openTransactionModal() {
    document.getElementById('transactionModal').style.display = 'block';
    document.getElementById('transactionForm').reset();
    document.getElementById('transactionId').value = '';
    document.getElementById('transactionModalTitle').textContent = 'Nova Transação';
    
    // Define a data de hoje como padrão
    document.getElementById('transactionDate').value = new Date().toISOString().split('T')[0];
    
    // Preenche o select de categorias
    populateCategorySelect('transactionCategory');
}

// Função para fechar o modal de transação
function closeTransactionModal() {
    document.getElementById('transactionModal').style.display = 'none';
}

// Preenche o select de categorias
function populateCategorySelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.innerHTML = '<option value="">Selecione uma categoria</option>';

    categories.forEach(category => {
        const option = document.createElement('option');
        option.value = category._id;
        option.textContent = category.name;
        option.style.color = category.color;
        select.appendChild(option);
    });
}

// Função para salvar transação
async function saveTransaction() {
    const transactionId = document.getElementById('transactionId').value;
    const description = document.getElementById('transactionDescription').value;
    const amount = parseFloat(document.getElementById('transactionAmount').value);
    const date = document.getElementById('transactionDate').value;
    const categoryId = document.getElementById('transactionCategory').value;
    const accountId = document.getElementById('transactionAccount').value;
    const type = document.querySelector('input[name="transactionType"]:checked').value;

    if (!description || !amount || !date || !categoryId || !accountId) {
        showNotification('Por favor, preencha todos os campos obrigatórios.', 'error');
        return;
    }

    const transactionData = {
        description,
        expense: type === 'expense' ? amount : 0,
        income: type === 'income' ? amount : 0,
        date,
        category_id: categoryId,
        account_id: accountId
    };

    try {
        if (transactionId) {
            await apiCall(`/api/transactions/${transactionId}`, {
                method: 'PUT',
                body: JSON.stringify(transactionData)
            });
            showNotification('Transação atualizada com sucesso!', 'success');
        } else {
            await apiCall('/api/transactions', {
                method: 'POST',
                body: JSON.stringify(transactionData)
            });
            showNotification('Transação criada com sucesso!', 'success');
        }

        closeTransactionModal();
        
        // Recarrega todos os dados
        await Promise.all([
            loadAccounts(),
            loadTransactions()
        ]);
        
        updateCharts();
    } catch (error) {
        console.error('Erro ao salvar transação:', error);
        showNotification('Erro ao salvar transação. Tente novamente.', 'error');
    }
}

// =====================================================
// RECEITAS
// =====================================================

async function loadIncomes() {
    try {
        const data = await apiCall('/api/incomes');
        incomes = data.incomes || [];
        console.log('Receitas carregadas:', incomes.length);
    } catch (error) {
        console.error('Erro ao carregar receitas:', error);
    }
}

// Função para abrir o modal de receita
function openIncomeModal() {
    document.getElementById('incomeModal').style.display = 'block';
    document.getElementById('incomeForm').reset();
    document.getElementById('incomeId').value = '';
    document.getElementById('incomeModalTitle').textContent = 'Nova Receita';
    
    // Define a data de hoje como padrão
    document.getElementById('incomeDate').value = new Date().toISOString().split('T')[0];
}

// Função para fechar o modal de receita
function closeIncomeModal() {
    document.getElementById('incomeModal').style.display = 'none';
}

// Função para salvar receita
async function saveIncome() {
    const incomeId = document.getElementById('incomeId').value;
    const description = document.getElementById('incomeDescription').value;
    const amount = parseFloat(document.getElementById('incomeAmount').value);
    const date = document.getElementById('incomeDate').value;
    const accountId = document.getElementById('incomeAccount').value;

    if (!description || !amount || !date || !accountId) {
        showNotification('Por favor, preencha todos os campos obrigatórios.', 'error');
        return;
    }

    const incomeData = {
        description,
        amount,
        date,
        account_id: accountId
    };

    try {
        if (incomeId) {
            await apiCall(`/api/incomes/${incomeId}`, {
                method: 'PUT',
                body: JSON.stringify(incomeData)
            });
            showNotification('Receita atualizada com sucesso!', 'success');
        } else {
            await apiCall('/api/incomes', {
                method: 'POST',
                body: JSON.stringify(incomeData)
            });
            showNotification('Receita criada com sucesso!', 'success');
        }

        closeIncomeModal();
        
        // Recarrega todos os dados
        await Promise.all([
            loadAccounts(),
            loadIncomes()
        ]);
    } catch (error) {
        console.error('Erro ao salvar receita:', error);
        showNotification('Erro ao salvar receita. Tente novamente.', 'error');
    }
}

// =====================================================
// ORÇAMENTOS
// =====================================================

async function loadBudgets() {
    try {
        const data = await apiCall('/api/budgets');
        budgets = data.budgets || [];
        displayBudgets();
    } catch (error) {
        console.error('Erro ao carregar orçamentos:', error);
    }
}

// Exibe os orçamentos na interface
function displayBudgets() {
    const budgetsContainer = document.getElementById('budgetsContainer');
    if (!budgetsContainer) return;

    budgetsContainer.innerHTML = '';

    if (budgets.length === 0) {
        budgetsContainer.innerHTML = '<p class="no-data">Nenhum orçamento encontrado.</p>';
        return;
    }

    budgets.forEach(budget => {
        const budgetElement = createBudgetElement(budget);
        budgetsContainer.appendChild(budgetElement);
    });
}

// Cria o elemento visual de um orçamento
function createBudgetElement(budget) {
    const div = document.createElement('div');
    div.className = 'budget-card';
    
    const category = getCategoryById(budget.category_id);
    const categoryName = category ? category.name : 'Sem categoria';
    const categoryColor = category ? category.color : '#888';
    
    // Calcula o total gasto no mês atual
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const spent = transactions
        .filter(t => {
            const transactionDate = new Date(t.date);
            return t.category_id === budget.category_id && 
                   transactionDate >= startOfMonth && 
                   transactionDate <= endOfMonth &&
                   parseFloat(t.expense) > 0;
        })
        .reduce((sum, t) => sum + parseFloat(t.expense), 0);
    
    const percentage = budget.amount > 0 ? Math.min((spent / budget.amount) * 100, 100) : 0;
    const remaining = budget.amount - spent;
    
    div.innerHTML = `
        <div class="budget-header">
            <h4>${categoryName}</h4>
            <span class="budget-percentage ${percentage >= 100 ? 'danger' : percentage >= 80 ? 'warning' : 'success'}">
                ${percentage.toFixed(0)}%
            </span>
        </div>
        <div class="budget-progress">
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${percentage}%; background-color: ${categoryColor}"></div>
            </div>
        </div>
        <div class="budget-details">
            <span>Gasto: R$ ${formatCurrency(spent)}</span>
            <span>Limite: R$ ${formatCurrency(budget.amount)}</span>
        </div>
        <div class="budget-remaining ${remaining < 0 ? 'negative' : ''}">
            ${remaining >= 0 ? `Restante: R$ ${formatCurrency(remaining)}` : `Excedido: R$ ${formatCurrency(Math.abs(remaining))}`}
        </div>
    `;

    return div;
}

// Função para abrir o modal de orçamento
function openBudgetModal() {
    document.getElementById('budgetModal').style.display = 'block';
    document.getElementById('budgetForm').reset();
    document.getElementById('budgetId').value = '';
    document.getElementById('budgetModalTitle').textContent = 'Novo Orçamento';
    populateCategorySelect('budgetCategory');
}

// Função para fechar o modal de orçamento
function closeBudgetModal() {
    document.getElementById('budgetModal').style.display = 'none';
}

// Função para salvar orçamento
async function saveBudget() {
    const budgetId = document.getElementById('budgetId').value;
    const categoryId = document.getElementById('budgetCategory').value;
    const amount = parseFloat(document.getElementById('budgetAmount').value);

    if (!categoryId || !amount) {
        showNotification('Por favor, preencha todos os campos obrigatórios.', 'error');
        return;
    }

    const budgetData = {
        category_id: categoryId,
        amount: amount
    };

    try {
        if (budgetId) {
            await apiCall(`/api/budgets/${budgetId}`, {
                method: 'PUT',
                body: JSON.stringify(budgetData)
            });
            showNotification('Orçamento atualizado com sucesso!', 'success');
        } else {
            await apiCall('/api/budgets', {
                method: 'POST',
                body: JSON.stringify(budgetData)
            });
            showNotification('Orçamento criado com sucesso!', 'success');
        }

        closeBudgetModal();
        loadBudgets();
    } catch (error) {
        console.error('Erro ao salvar orçamento:', error);
        showNotification('Erro ao salvar orçamento. Tente novamente.', 'error');
    }
}

// =====================================================
// METAS
// =====================================================

async function loadGoals() {
    try {
        const data = await apiCall('/api/goals');
        goals = data.goals || [];
        displayGoals();
    } catch (error) {
        console.error('Erro ao carregar metas:', error);
    }
}

// Exibe as metas na interface
function displayGoals() {
    const goalsContainer = document.getElementById('goalsContainer');
    if (!goalsContainer) return;

    goalsContainer.innerHTML = '';

    if (goals.length === 0) {
        goalsContainer.innerHTML = '<p class="no-data">Nenhuma meta encontrada.</p>';
        return;
    }

    goals.forEach(goal => {
        const goalElement = createGoalElement(goal);
        goalsContainer.appendChild(goalElement);
    });
}

// Cria o elemento visual de uma meta
function createGoalElement(goal) {
    const div = document.createElement('div');
    div.className = 'goal-card';
    
    const percentage = goal.target_amount > 0 ? Math.min((goal.current_amount / goal.target_amount) * 100, 100) : 0;
    const remaining = goal.target_amount - goal.current_amount;
    const deadline = new Date(goal.deadline);
    const daysRemaining = Math.ceil((deadline - new Date()) / (1000 * 60 * 60 * 24));
    
    div.innerHTML = `
        <div class="goal-header">
            <h4>${goal.name}</h4>
            <span class="goal-percentage">${percentage.toFixed(0)}%</span>
        </div>
        <div class="goal-progress">
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${percentage}%"></div>
            </div>
        </div>
        <div class="goal-details">
            <span>Atual: R$ ${formatCurrency(goal.current_amount)}</span>
            <span>Meta: R$ ${formatCurrency(goal.target_amount)}</span>
        </div>
        <div class="goal-remaining">
            ${remaining > 0 ? `Faltam: R$ ${formatCurrency(remaining)}` : 'Meta alcançada!'}
        </div>
        <div class="goal-deadline">
            ${daysRemaining > 0 ? `${daysRemaining} dias restantes` : 'Prazo exceeded'}
        </div>
    `;

    return div;
}

// Função para abrir o modal de meta
function openGoalModal() {
    document.getElementById('goalModal').style.display = 'block';
    document.getElementById('goalForm').reset();
    document.getElementById('goalId').value = '';
    document.getElementById('goalModalTitle').textContent = 'Nova Meta';
    
    // Define a data de 1 ano como padrão
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    document.getElementById('goalDeadline').value = nextYear.toISOString().split('T')[0];
}

// Função para fechar o modal de meta
function closeGoalModal() {
    document.getElementById('goalModal').style.display = 'none';
}

// Função para salvar meta
async function saveGoal() {
    const goalId = document.getElementById('goalId').value;
    const name = document.getElementById('goalName').value;
    const targetAmount = parseFloat(document.getElementById('goalTargetAmount').value);
    const currentAmount = parseFloat(document.getElementById('goalCurrentAmount').value) || 0;
    const deadline = document.getElementById('goalDeadline').value;

    if (!name || !targetAmount || !deadline) {
        showNotification('Por favor, preencha todos os campos obrigatórios.', 'error');
        return;
    }

    const goalData = {
        name,
        target_amount: targetAmount,
        current_amount: currentAmount,
        deadline
    };

    try {
        if (goalId) {
            await apiCall(`/api/goals/${goalId}`, {
                method: 'PUT',
                body: JSON.stringify(goalData)
            });
            showNotification('Meta atualizada com sucesso!', 'success');
        } else {
            await apiCall('/api/goals', {
                method: 'POST',
                body: JSON.stringify(goalData)
            });
            showNotification('Meta criada com sucesso!', 'success');
        }

        closeGoalModal();
        loadGoals();
    } catch (error) {
        console.error('Erro ao salvar meta:', error);
        showNotification('Erro ao salvar meta. Tente novamente.', 'error');
    }
}

// =====================================================
// RESUMO DA CONTA (SIDEBAR)
// =====================================================

function updateAccountSummary() {
    const select = document.getElementById('overviewAccount');
    if (!select) return;
    
    const selectedAccountId = select.value;
    
    if (!selectedAccountId || selectedAccountId === 'all') {
        // Se "Todas as contas" estiver selecionado, limpa o resumo
        const summaryContainer = document.getElementById('accountSummaryContainer');
        if (summaryContainer) {
            summaryContainer.innerHTML = '<p class="no-data">Selecione uma conta para ver o resumo.</p>';
        }
        return;
    }
    
    const account = accounts.find(a => a._id === selectedAccountId);
    if (!account) return;
    
    // Calcula total de receitas
    const accountIncomes = incomes.filter(i => i.account_id === selectedAccountId);
    const totalIncomes = accountIncomes.reduce((sum, i) => sum + parseFloat(i.amount), 0);
    
    // Calcula total de despesas
    const accountTransactions = transactions.filter(t => t.account_id === selectedAccountId);
    const totalExpenses = accountTransactions
        .filter(t => parseFloat(t.expense) > 0)
        .reduce((sum, t) => sum + parseFloat(t.expense), 0);
    
    // Atualiza a interface
    const summaryContainer = document.getElementById('accountSummaryContainer');
    if (summaryContainer) {
        summaryContainer.innerHTML = `
            <div class="summary-item">
                <span class="summary-label">Saldo Atual</span>
                <span class="summary-value ${account.balance >= 0 ? 'positive' : 'negative'}">R$ ${formatCurrency(account.balance || 0)}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Total Receitas</span>
                <span class="summary-value positive">R$ ${formatCurrency(totalIncomes)}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Total Despesas</span>
                <span class="summary-value negative">R$ ${formatCurrency(totalExpenses)}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Tipo de Conta</span>
                <span class="summary-value">${getAccountTypeName(account.type)}</span>
            </div>
        `;
    }
}

// Atualiza o resumo da overview quando uma conta é selecionada
document.addEventListener('DOMContentLoaded', function() {
    const overviewAccountSelect = document.getElementById('overviewAccount');
    if (overviewAccountSelect) {
        overviewAccountSelect.addEventListener('change', function() {
            updateAccountSummary();
            displayTransactions();
        });
    }
});

function updateOverviewAccountSummary() {
    // Esta função é chamada para manter compatibilidade com loadAccounts
    // A lógica real está em updateAccountSummary que é chamada pelo event listener
}

// =====================================================
// GRÁFICOS
// =====================================================

function updateCharts() {
    updateExpenseChart();
    updateIncomeVsExpenseChart();
}

// Gráfico de despesas por categoria
function updateExpenseChart() {
    const ctx = document.getElementById('expenseChart');
    if (!ctx) return;

    // Calcula despesas por categoria
    const expensesByCategory = {};
    
    transactions.forEach(transaction => {
        if (parseFloat(transaction.expense) > 0) {
            const categoryName = getCategoryName(transaction.category_id);
            expensesByCategory[categoryName] = (expensesByCategory[categoryName] || 0) + parseFloat(transaction.expense);
        }
    });

    const labels = Object.keys(expensesByCategory);
    const data = Object.values(expensesByCategory);

    // Cores para as categorias
    const colors = labels.map(name => {
        const category = categories.find(c => c.name === name);
        return category ? category.color : '#888';
    });

    if (charts.expenseChart) {
        charts.expenseChart.destroy();
    }

    charts.expenseChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        font: {
                            size: 12
                        },
                        padding: 15
                    }
                }
            }
        }
    });
}

// Gráfico de receitas vs despesas
function updateIncomeVsExpenseChart() {
    const ctx = document.getElementById('incomeExpenseChart');
    if (!ctx) return;

    // Agrupa por mês
    const monthlyData = {};
    
    transactions.forEach(transaction => {
        const date = new Date(transaction.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        if (!monthlyData[monthKey]) {
            monthlyData[monthKey] = { income: 0, expense: 0 };
        }
        
        monthlyData[monthKey].income += parseFloat(transaction.income) || 0;
        monthlyData[monthKey].expense += parseFloat(transaction.expense) || 0;
    });

    const sortedKeys = Object.keys(monthlyData).sort().slice(-6); // Últimos 6 meses
    
    const labels = sortedKeys.map(key => {
        const [year, month] = key.split('-');
        return new Date(year, month - 1).toLocaleDateString('pt-BR', { month: 'short' });
    });
    
    const incomeData = sortedKeys.map(key => monthlyData[key].income);
    const expenseData = sortedKeys.map(key => monthlyData[key].expense);

    if (charts.incomeExpenseChart) {
        charts.incomeExpenseChart.destroy();
    }

    charts.incomeExpenseChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Receitas',
                    data: incomeData,
                    backgroundColor: '#2ecc71'
                },
                {
                    label: 'Despesas',
                    data: expenseData,
                    backgroundColor: '#e74c3c'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return 'R$ ' + formatCurrency(value);
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top'
                }
            }
        }
    });
}

// =====================================================
// TRANSFERÊNCIAS
// =====================================================

// Função para abrir o modal de transferência
function openTransferModal() {
    document.getElementById('transferModal').style.display = 'block';
    document.getElementById('transferForm').reset();
    document.getElementById('transferId').value = '';
    document.getElementById('transferModalTitle').textContent = 'Nova Transferência';
    
    // Define a data de hoje como padrão
    document.getElementById('transferDate').value = new Date().toISOString().split('T')[0];
    
    // Atualiza os selects de contas
    updateAccountSelects();
}

// Função para fechar o modal de transferência
function closeTransferModal() {
    document.getElementById('transferModal').style.display = 'none';
}

// Função para salvar transferência
async function saveTransfer() {
    const fromAccountId = document.getElementById('transferFromAccount').value;
    const toAccountId = document.getElementById('transferToAccount').value;
    const amount = parseFloat(document.getElementById('transferAmount').value);
    const date = document.getElementById('transferDate').value;
    const description = document.getElementById('transferDescription').value;

    // Validações
    if (!fromAccountId || !toAccountId || !amount || !date) {
        showNotification('Por favor, preencha todos os campos obrigatórios.', 'error');
        console.log('Erro de validação: campos obrigatórios não preenchidos');
        return;
    }

    if (fromAccountId === toAccountId) {
        showNotification('As contas de origem e destino devem ser diferentes.', 'error');
        console.log('Erro de validação: contas iguais');
        return;
    }

    if (amount <= 0) {
        showNotification('O valor deve ser maior que zero.', 'error');
        console.log('Erro de validação: valor inválido');
        return;
    }

    const transferData = {
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        amount: amount,
        date: date,
        description: description
    };

    console.log('Enviando dados de transferência:', transferData);

    try {
        const response = await apiCall('/api/transfer', {
            method: 'POST',
            body: JSON.stringify(transferData)
        });
        
        console.log('Resposta da API:', response);
        showNotification('Transferência realizada com sucesso!', 'success');
        
        closeTransferModal();
        
        // Recarrega os dados das contas para refletir o novo saldo
        await loadAccounts();
        
    } catch (error) {
        console.error('Erro ao realizar transferência:', error);
        showNotification(error.message || 'Erro ao realizar transferência. Tente novamente.', 'error');
    }
}

// =====================================================
// CATEGORIAS (MODAL)
// =====================================================

// Função para abrir o modal de categoria
function openCategoryModal() {
    document.getElementById('categoryModal').style.display = 'block';
    document.getElementById('categoryForm').reset();
    document.getElementById('categoryId').value = '';
    document.getElementById('categoryModalTitle').textContent = 'Nova Categoria';
}

// Função para fechar o modal de categoria
function closeCategoryModal() {
    document.getElementById('categoryModal').style.display = 'none';
}

// Função para salvar categoria
async function saveCategory() {
    const categoryId = document.getElementById('categoryId').value;
    const name = document.getElementById('categoryName').value;
    const color = document.getElementById('categoryColor').value;

    if (!name || !color) {
        showNotification('Por favor, preencha todos os campos obrigatórios.', 'error');
        return;
    }

    const categoryData = {
        name,
        color
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

        closeCategoryModal();
        loadCategories();
    } catch (error) {
        console.error('Erro ao salvar categoria:', error);
        showNotification('Erro ao salvar categoria. Tente novamente.', 'error');
    }
}

// Função para editar categoria
async function editCategory(categoryId) {
    try {
        const category = categories.find(c => c._id === categoryId);
        if (!category) return;

        document.getElementById('categoryId').value = category._id;
        document.getElementById('categoryName').value = category.name;
        document.getElementById('categoryColor').value = category.color;

        document.getElementById('categoryModalTitle').textContent = 'Editar Categoria';
        document.getElementById('categoryModal').style.display = 'block';
    } catch (error) {
        console.error('Erro ao carregar categoria:', error);
        showNotification('Erro ao carregar dados da categoria.', 'error');
    }
}

// Função para excluir categoria
async function deleteCategory(categoryId) {
    if (!confirm('Tem certeza que deseja excluir esta categoria?')) {
        return;
    }

    try {
        await apiCall(`/api/categories/${categoryId}`, {
            method: 'DELETE'
        });
        showNotification('Categoria excluída com sucesso!', 'success');
        loadCategories();
    } catch (error) {
        console.error('Erro ao excluir categoria:', error);
        showNotification('Erro ao excluir categoria. Tente novamente.', 'error');
    }
}

// =====================================================
// UTILITÁRIOS
// =====================================================

// Formata moeda
function formatCurrency(value) {
    if (value === null || value === undefined) return '0,00';
    return parseFloat(value).toFixed(2).replace('.', ',');
}

// Notificações
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <span>${message}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    
    document.body.appendChild(notification);
    
    // Auto remove após 5 segundos
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// Logout
function logout() {
    if (confirm('Tem certeza que deseja sair?')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = 'index.html';
    }
}

// Função para mostrar/esconder seções
function toggleSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.style.display = section.style.display === 'none' ? 'block' : 'none';
    }
}

