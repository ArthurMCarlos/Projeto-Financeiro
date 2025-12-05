// credit_card_manager.js
/**
 * Gerenciador de cartões de crédito no frontend
 * Funcionalidades: CRUD, configuração de reset automático, histórico
 */

class CreditCardManager {
    constructor() {
        this.apiBase = 'https://projeto-financeiro-c8sb.onrender.com';
        this.creditCards = [];
        this.currentCard = null;
    }

    // Headers padrão para requisições
    getAuthHeaders() {
        const token = localStorage.getItem('token');
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
    }

    // API wrapper
    async apiCall(endpoint, options = {}) {
        const url = `${this.apiBase}${endpoint}`;
        const config = {
            headers: this.getAuthHeaders(),
            ...options
        };

        const response = await fetch(url, config);
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Erro HTTP ${response.status}`);
        }

        return response.json();
    }

    // CARREGAR CARTÕES
    async loadCreditCards() {
        try {
            const data = await this.apiCall('/api/credit-card/');
            this.creditCards = data.credit_cards || [];
            this.renderCreditCardsList();
            return this.creditCards;
        } catch (error) {
            console.error('Erro ao carregar cartões:', error);
            throw error;
        }
    }

    // OBTER DETALHES DE UM CARTÃO
    async getCreditCardDetails(cardId) {
        try {
            const data = await this.apiCall(`/api/credit-card/${cardId}`);
            this.currentCard = data.credit_card;
            return this.currentCard;
        } catch (error) {
            console.error('Erro ao carregar detalhes do cartão:', error);
            throw error;
        }
    }

    // CONFIGURAR CARTÃO DE CRÉDITO
    async configureCreditCard(cardId, config) {
        try {
            const data = await this.apiCall(`/api/credit-card/${cardId}/configure`, {
                method: 'PUT',
                body: JSON.stringify(config)
            });
            
            // Atualiza lista local
            await this.loadCreditCards();
            
            return data;
        } catch (error) {
            console.error('Erro ao configurar cartão:', error);
            throw error;
        }
    }

    // RESET MANUAL
    async manualReset(cardId) {
        try {
            const data = await this.apiCall(`/api/credit-card/${cardId}/manual-reset`, {
                method: 'POST'
            });
            
            // Atualiza lista local
            await this.loadCreditCards();
            
            return data;
        } catch (error) {
            console.error('Erro ao executar reset manual:', error);
            throw error;
        }
    }

    // OBTER PRÓXIMOS RESETS
    async getUpcomingResets() {
        try {
            const data = await this.apiCall('/api/credit-card/upcoming-resets');
            return data.upcoming_resets || [];
        } catch (error) {
            console.error('Erro ao carregar próximos resets:', error);
            throw error;
        }
    }

    // OBTER ESTATÍSTICAS
    async getStats() {
        try {
            const data = await this.apiCall('/api/credit-card/stats');
            return data;
        } catch (error) {
            console.error('Erro ao carregar estatísticas:', error);
            throw error;
        }
    }

    // RENDERIZAR LISTA DE CARTÕES
    renderCreditCardsList() {
        const container = document.getElementById('creditCardsList');
        if (!container) return;

        if (this.creditCards.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>💳 Nenhum cartão de crédito encontrado</h3>
                    <p>Adicione um cartão de crédito para começar a acompanhar seus gastos</p>
                    <button onclick="openCreditCardModal()" class="btn-primary">
                        💳 Adicionar Cartão de Crédito
                    </button>
                </div>
            `;
            return;
        }

        const cardsHtml = this.creditCards.map(card => this.renderCreditCard(card)).join('');
        container.innerHTML = `
            <div class="credit-cards-grid">
                ${cardsHtml}
            </div>
        `;
    }

    // RENDERIZAR UM CARTÃO INDIVIDUAL
    renderCreditCard(card) {
        const creditUtilization = (card.balance / card.credit_limit * 100).toFixed(1);
        const isNearLimit = creditUtilization > 80;
        const hasAutoReset = card.auto_reset;
        
        let statusColor = 'success';
        if (isNearLimit) statusColor = 'warning';
        if (creditUtilization > 95) statusColor = 'danger';

        return `
            <div class="credit-card-item" data-card-id="${card.id}">
                <div class="credit-card-header">
                    <div class="card-info">
                        <h4>${card.name}</h4>
                        <span class="card-type">💳 Cartão de Crédito</span>
                    </div>
                    <div class="card-actions">
                        <button onclick="creditCardManager.editCard('${card.id}')" class="btn-icon" title="Editar">
                            ✏️
                        </button>
                        <button onclick="creditCardManager.deleteCard('${card.id}')" class="btn-icon danger" title="Excluir">
                            🗑️
                        </button>
                    </div>
                </div>

                <div class="credit-card-balance">
                    <div class="balance-info">
                        <span class="balance-label">Saldo Atual:</span>
                        <span class="balance-value ${statusColor}">${this.formatCurrency(card.balance)}</span>
                    </div>
                    <div class="limit-info">
                        <span class="limit-label">Limite:</span>
                        <span class="limit-value">${this.formatCurrency(card.credit_limit)}</span>
                    </div>
                </div>

                <div class="credit-utilization">
                    <div class="utilization-bar">
                        <div class="utilization-fill ${statusColor}" style="width: ${creditUtilization}%"></div>
                    </div>
                    <span class="utilization-text">${creditUtilization}% utilizado</span>
                </div>

                <div class="auto-reset-status">
                    ${hasAutoReset ? 
                        `<span class="auto-reset-enabled">🔄 Reset Automático (Dia ${card.auto_reset_day})</span>` :
                        `<span class="auto-reset-disabled">❌ Reset Automático Desabilitado</span>`
                    }
                </div>

                <div class="card-footer">
                    ${hasAutoReset && card.last_reset_date ? 
                        `<small>Último reset: ${this.formatDate(card.last_reset_date)}</small>` :
                        `<small>Configure o reset automático para maior controle</small>`
                    }
                </div>

                <div class="card-quick-actions">
                    <button onclick="creditCardManager.openConfigureModal('${card.id}')" class="btn-secondary btn-sm">
                        ⚙️ Configurar
                    </button>
                    <button onclick="creditCardManager.manualReset('${card.id}')" class="btn-warning btn-sm">
                        🔄 Reset Manual
                    </button>
                    <button onclick="creditCardManager.viewHistory('${card.id}')" class="btn-secondary btn-sm">
                        📊 Histórico
                    </button>
                </div>
            </div>
        `;
    }

    // ABRIR MODAL DE CONFIGURAÇÃO
    async openConfigureModal(cardId) {
        try {
            const card = this.creditCards.find(c => c.id === cardId);
            if (!card) {
                alert('Cartão não encontrado');
                return;
            }

            const modal = this.createConfigureModal(card);
            document.body.appendChild(modal);
            
            // Preenche o modal
            document.getElementById('configCardName').textContent = card.name;
            document.getElementById('configCreditLimit').value = card.credit_limit || '';
            document.getElementById('configBillClosingDay').value = card.bill_closing_day || '';
            document.getElementById('configAutoResetDay').value = card.auto_reset_day || card.bill_closing_day || '';
            document.getElementById('configAutoReset').checked = card.auto_reset || false;

            modal.style.display = 'block';
        } catch (error) {
            console.error('Erro ao abrir modal de configuração:', error);
            alert('Erro ao carregar dados do cartão');
        }
    }

    // CRIAR MODAL DE CONFIGURAÇÃO
    createConfigureModal(card) {
        return `
            <div id="configureCreditCardModal" class="modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>💳 Configurar ${card.name}</h3>
                        <span class="close" onclick="closeConfigureModal()">&times;</span>
                    </div>
                    
                    <form id="configureCreditCardForm">
                        <div class="form-group">
                            <label for="configCreditLimit">Limite de Crédito (R$):</label>
                            <input type="number" id="configCreditLimit" step="0.01" min="0" class="input" required>
                        </div>

                        <div class="form-group">
                            <label for="configBillClosingDay">Dia de Fechamento da Fatura:</label>
                            <select id="configBillClosingDay" class="input" required>
                                <option value="">Selecione o dia</option>
                                ${this.generateDaysSelect()}
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="configAutoResetDay">Dia do Reset Automático:</label>
                            <select id="configAutoResetDay" class="input">
                                <option value="">Mesmo dia do fechamento</option>
                                ${this.generateDaysSelect()}
                            </select>
                        </div>

                        <div class="form-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="configAutoReset">
                                <span class="checkmark"></span>
                                Habilitar reset automático do limite
                            </label>
                            <small class="form-help">
                                Quando ativado, o saldo será zerado automaticamente no dia definido
                            </small>
                        </div>

                        <div class="modal-actions">
                            <button type="submit" class="btn-primary">Salvar Configurações</button>
                            <button type="button" class="btn-secondary" onclick="closeConfigureModal()">Cancelar</button>
                        </div>
                    </form>

                    <div class="config-tips">
                        <h4>💡 Dicas de Configuração</h4>
                        <ul>
                            <li>O reset automático zera o saldo para o limite do cartão</li>
                            <li>Configure o dia do reset alguns dias após o fechamento</li>
                            <li>O histórico de resets fica registrado para auditoria</li>
                            <li>Você pode fazer reset manual quando necessário</li>
                        </ul>
                    </div>
                </div>
            </div>
        `;
    }

    // GERAR SELEÇÃO DE DIAS (1-31)
    generateDaysSelect(selectedDay = '') {
        let options = '';
        for (let day = 1; day <= 31; day++) {
            const selected = selectedDay == day ? 'selected' : '';
            options += `<option value="${day}" ${selected}>${day}</option>`;
        }
        return options;
    }

    // SALVAR CONFIGURAÇÃO
    async saveConfiguration(event) {
        event.preventDefault();
        
        const cardId = this.currentCard?.id;
        if (!cardId) return;

        const config = {
            credit_limit: parseFloat(document.getElementById('configCreditLimit').value),
            bill_closing_day: parseInt(document.getElementById('configBillClosingDay').value),
            auto_reset_day: parseInt(document.getElementById('configAutoResetDay').value) || 
                           parseInt(document.getElementById('configBillClosingDay').value),
            auto_reset: document.getElementById('configAutoReset').checked
        };

        try {
            await this.configureCreditCard(cardId, config);
            alert('✅ Configurações salvas com sucesso!');
            closeConfigureModal();
            this.renderCreditCardsList();
        } catch (error) {
            console.error('Erro ao salvar configuração:', error);
            alert('❌ Erro ao salvar configurações: ' + error.message);
        }
    }

    // VER HISTÓRICO
    async viewHistory(cardId) {
        try {
            const data = await this.apiCall(`/api/credit-card/${cardId}/reset-history?limit=20`);
            this.showHistoryModal(data.reset_history || []);
        } catch (error) {
            console.error('Erro ao carregar histórico:', error);
            alert('Erro ao carregar histórico de resets');
        }
    }

    // MOSTRAR MODAL DE HISTÓRICO
    showHistoryModal(resetHistory) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>📊 Histórico de Resets</h3>
                    <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
                </div>
                
                <div class="reset-history">
                    ${resetHistory.length === 0 ? 
                        '<p>Nenhum reset registrado ainda</p>' :
                        this.renderResetHistoryList(resetHistory)
                    }
                </div>
                
                <div class="modal-actions">
                    <button class="btn-secondary" onclick="this.closest('.modal').remove()">Fechar</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'block';
    }

    // RENDERIZAR LISTA DO HISTÓRICO
    renderResetHistoryList(history) {
        return `
            <div class="history-list">
                ${history.map(reset => `
                    <div class="history-item">
                        <div class="reset-info">
                            <strong>${this.formatDate(reset.date)}</strong>
                            <span class="reset-amount ${reset.reset_amount < 0 ? 'expense' : 'income'}">
                                ${this.formatCurrency(Math.abs(reset.reset_amount))}
                                ${reset.reset_type === 'manual' ? '(Manual)' : '(Automático)'}
                            </span>
                        </div>
                        <div class="balance-info">
                            Saldo: ${this.formatCurrency(reset.new_balance)} / 
                            Limite: ${this.formatCurrency(reset.credit_limit)}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // ABRIR MODAL DE HISTÓRICO
    async openHistoryModal(cardId) {
        try {
            const data = await this.apiCall(`/api/credit-card/${cardId}/reset-history?limit=20`);
            this.showHistoryModal(data.reset_history || []);
        } catch (error) {
            console.error('Erro ao carregar histórico:', error);
            alert('Erro ao carregar histórico de resets');
        }
    }

    // EDITAR CARTÃO
    editCard(cardId) {
        const card = this.creditCards.find(c => c.id === cardId);
        if (!card) return;

        // Usa o modal existente de conta com campos específicos para cartão
        document.getElementById('accountId').value = cardId;
        document.getElementById('accountName').value = card.name;
        document.getElementById('accountType').value = 'cartao';
        document.getElementById('accountBalance').value = card.balance;
        
        // Adiciona campos específicos do cartão
        this.addCreditCardFields(card);
        
        document.getElementById('accountModalTitle').textContent = 'Editar Cartão de Crédito';
        document.getElementById('accountModal').style.display = 'block';
    }

    // ADICIONAR CAMPOS ESPECÍFICOS DO CARTÃO
    addCreditCardFields(card) {
        const form = document.getElementById('accountForm');
        
        // Remove campos antigos se existirem
        const existingFields = form.querySelectorAll('.credit-card-field');
        existingFields.forEach(field => field.remove());

        // Adiciona novos campos
        const creditLimitField = document.createElement('div');
        creditLimitField.className = 'form-group credit-card-field';
        creditLimitField.innerHTML = `
            <label for="accountCreditLimit">Limite de Crédito (R$):</label>
            <input type="number" id="accountCreditLimit" step="0.01" min="0" 
                   value="${card.credit_limit || ''}" class="input" required>
        `;

        const billingDayField = document.createElement('div');
        billingDayField.className = 'form-group credit-card-field';
        billingDayField.innerHTML = `
            <label for="accountBillingDay">Dia de Fechamento:</label>
            <select id="accountBillingDay" class="input" required>
                <option value="">Selecione o dia</option>
                ${this.generateDaysSelect()}
            </select>
        `;

        form.insertBefore(creditLimitField, form.querySelector('.form-actions'));
        form.insertBefore(billingDayField, form.querySelector('.form-actions'));
    }

    // EXCLUIR CARTÃO
    async deleteCard(cardId) {
        if (!confirm('Tem certeza que deseja excluir este cartão de crédito?')) {
            return;
        }

        try {
            await this.apiCall(`/api/accounts/${cardId}`, { method: 'DELETE' });
            await this.loadCreditCards();
            alert('Cartão excluído com sucesso!');
        } catch (error) {
            console.error('Erro ao excluir cartão:', error);
            alert('Erro ao excluir cartão: ' + error.message);
        }
    }

    // FORMATAR MOEDA
    formatCurrency(value) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(value || 0);
    }

    // FORMATAR DATA
    formatDate(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return new Intl.DateTimeFormat('pt-BR').format(date);
    }

    // ATUALIZAR ESTATÍSTICAS DO DASHBOARD
    async updateDashboardStats() {
        try {
            const stats = await this.getStats();
            
            // Atualiza elementos do dashboard se existirem
            const elements = {
                totalCreditLimit: document.getElementById('totalCreditLimit'),
                totalCreditUsed: document.getElementById('totalCreditUsed'),
                availableCredit: document.getElementById('availableCredit'),
                creditUtilizationRate: document.getElementById('creditUtilizationRate')
            };

            if (elements.totalCreditLimit) {
                elements.totalCreditLimit.textContent = this.formatCurrency(stats.total_credit_limit);
            }

            if (elements.totalCreditUsed) {
                elements.totalCreditUsed.textContent = this.formatCurrency(stats.total_current_balance);
           elements.availableCredit) }

            if ( {
                elements.availableCredit.textContent = this.formatCurrency(stats.total_available_credit);
            }

            if (elements.creditUtilizationRate) {
                elements.creditUtilizationRate.textContent = `${stats.credit_utilization_rate.toFixed(1)}%`;
            }

        } catch (error) {
            console.error('Erro ao atualizar estatísticas:', error);
        }
    }

    // INICIALIZAR
    async initialize() {
        try {
            await this.loadCreditCards();
            await this.updateDashboardStats();
        } catch (error) {
            console.error('Erro ao inicializar CreditCardManager:', error);
        }
    }
}

// Instância global
const creditCardManager = new CreditCardManager();

// Funções globais para eventos
function openCreditCardModal() {
    document.getElementById('accountModalTitle').textContent = 'Novo Cartão de Crédito';
    document.getElementById('accountForm').reset();
    document.getElementById('accountId').value = '';
    document.getElementById('accountType').value = 'cartao';
    document.getElementById('accountModal').style.display = 'block';
}

function closeConfigureModal() {
    const modal = document.getElementById('configureCreditCardModal');
    if (modal) {
        modal.remove();
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Adiciona listener para o formulário de configuração
    const configForm = document.getElementById('configureCreditCardForm');
    if (configForm) {
        configForm.addEventListener('submit', (e) => creditCardManager.saveConfiguration(e));
    }

    // Atualiza o campo de reset day quando o fechamento muda
    const billClosingDay = document.getElementById('configBillClosingDay');
    if (billClosingDay) {
        billClosingDay.addEventListener('change', function() {
            const resetDay = document.getElementById('configAutoResetDay');
            if (resetDay && !resetDay.value) {
                resetDay.value = this.value;
            }
        });
    }
});

// Adicionar estilos CSS dinâmicos
const style = document.createElement('style');
style.textContent = `
    .credit-cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
        gap: 1.5rem;
        margin-top: 1rem;
    }

    .credit-card-item {
        background: white;
        border-radius: 12px;
        padding: 1.5rem;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        border-left: 4px solid #4CAF50;
        transition: transform 0.2s, box-shadow 0.2s;
    }

    .credit-card-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    }

    .credit-card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 1rem;
    }

    .card-info h4 {
        margin: 0;
        color: #333;
        font-size: 1.2rem;
    }

    .card-type {
        color: #666;
        font-size: 0.9rem;
        margin-top: 0.25rem;
    }

    .card-actions {
        display: flex;
        gap: 0.5rem;
    }

    .credit-card-balance {
        display: flex;
        justify-content: space-between;
        margin-bottom: 1rem;
        padding: 0.75rem;
        background: #f8f9fa;
        border-radius: 8px;
    }

    .balance-info, .limit-info {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .balance-label, .limit-label {
        font-size: 0.85rem;
        color: #666;
    }

    .balance-value, .limit-value {
        font-weight: bold;
        font-size: 1.1rem;
    }

    .balance-value.success { color: #4CAF50; }
    .balance-value.warning { color: #FF9800; }
    .balance-value.danger { color: #F44336; }

    .credit-utilization {
        margin-bottom: 1rem;
    }

    .utilization-bar {
        width: 100%;
        height: 8px;
        background: #e0e0e0;
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 0.5rem;
    }

    .utilization-fill {
        height: 100%;
        transition: width 0.3s;
    }

    .utilization-fill.success { background: #4CAF50; }
    .utilization-fill.warning { background: #FF9800; }
    .utilization-fill.danger { background: #F44336; }

    .utilization-text {
        font-size: 0.85rem;
        color: #666;
    }

    .auto-reset-status {
        margin-bottom: 1rem;
        padding: 0.5rem;
        border-radius: 6px;
        text-align: center;
    }

    .auto-reset-enabled {
        background: #e8f5e8;
        color: #2e7d32;
        padding: 0.5rem;
        border-radius: 6px;
        font-size: 0.9rem;
    }

    .auto-reset-disabled {
        background: #ffebee;
        color: #c62828;
        padding: 0.5rem;
        border-radius: 6px;
        font-size: 0.9rem;
    }

    .card-footer {
        margin-bottom: 1rem;
    }

    .card-footer small {
        color: #666;
        font-size: 0.8rem;
    }

    .card-quick-actions {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
    }

    .btn-sm {
        padding: 0.5rem 1rem;
        font-size: 0.85rem;
    }

    .empty-state {
        text-align: center;
        padding: 3rem;
        color: #666;
    }

    .empty-state h3 {
        margin-bottom: 1rem;
        color: #333;
    }

    .empty-state p {
        margin-bottom: 2rem;
        font-size: 1.1rem;
    }

    .config-tips {
        margin-top: 1.5rem;
        padding: 1rem;
        background: #f8f9fa;
        border-radius: 8px;
    }

    .config-tips h4 {
        margin: 0 0 0.5rem 0;
        color: #333;
    }

    .config-tips ul {
        margin: 0;
        padding-left: 1.2rem;
    }

    .config-tips li {
        margin-bottom: 0.5rem;
        color: #666;
    }

    .form-help {
        display: block;
        margin-top: 0.25rem;
        color: #666;
        font-size: 0.85rem;
    }

    .history-list {
        max-height: 400px;
        overflow-y: auto;
    }

    .history-item {
        padding: 0.75rem;
        border-bottom: 1px solid #eee;
    }

    .history-item:last-child {
        border-bottom: none;
    }

    .reset-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
    }

    .reset-amount {
        font-weight: bold;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
    }

    .reset-amount.expense {
        background: #ffebee;
        color: #c62828;
    }

    .reset-amount.income {
        background: #e8f5e8;
        color: #2e7d32;
    }

    .balance-info {
        color: #666;
        font-size: 0.9rem;
    }

    .checkbox-label {
        display: flex;
        align-items: center;
        cursor: pointer;
        margin-bottom: 0.5rem;
    }

    .checkmark {
        margin-left: 0.5rem;
    }
`;
document.head.appendChild(style);