// Goals management functionality
// Nota: a variável `goals` é declarada em dashboard.js e compartilhada entre os arquivos.

// Initialize goals functionality — chamado por initializeEventListeners no dashboard.js
async function initializeGoals() {
    await loadGoals();
    // Não chama initializeGoalEventListeners aqui — já é chamado pelo dashboard.js
}

function initializeGoalEventListeners() {
    const addBtn = document.getElementById('addGoalBtn');
    if (addBtn) addBtn.addEventListener('click', () => openGoalModal());

    const statusFilter = document.getElementById('goalStatusFilter');
    if (statusFilter) statusFilter.addEventListener('change', filterGoals);

    const typeFilter = document.getElementById('goalTypeFilter');
    if (typeFilter) typeFilter.addEventListener('change', filterGoals);

    const form = document.getElementById('goalForm');
    if (form) form.addEventListener('submit', saveGoal);

    const goalTypeSelect = document.getElementById('goalType');
    if (goalTypeSelect) goalTypeSelect.addEventListener('change', handleGoalTypeChange);
}

// API Functions for Goals
async function loadGoals() {
    try {
        const data = await apiCall('/api/goals');
        goals = data.goals || [];
        displayGoals();
        displayGoalsPreview();
        checkGoalAlerts();
    } catch (error) {
        console.error('Erro ao carregar metas:', error);
    }
}

async function saveGoal(event) {
    event.preventDefault();

    const goalId = document.getElementById('goalId').value;

    const goalData = {
        name:           document.getElementById('goalTitle').value.trim(),
        description:    document.getElementById('goalDescription').value.trim(),
        goal_type:      document.getElementById('goalType').value,
        target_amount:  parseFloat(document.getElementById('goalTargetAmount').value),
        current_amount: parseFloat(document.getElementById('goalCurrentAmount').value) || 0,
        deadline:       document.getElementById('goalTargetDate').value,
        category_id:    document.getElementById('goalCategory').value || null
    };

    try {
        if (goalId) {
            await apiCall(`/api/goals/${goalId}`, { method: 'PUT', body: JSON.stringify(goalData) });
        } else {
            await apiCall('/api/goals', { method: 'POST', body: JSON.stringify(goalData) });
        }
        closeGoalModal();
        await loadGoals();
        showToast('Meta salva com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao salvar meta:', error);
        showToast('Erro ao salvar meta', 'error');
    }
}

async function deleteGoal(goalId) {
    if (!confirm('Tem certeza que deseja excluir esta meta?')) {
        return;
    }

    try {
        await apiCall(`/api/goals/${goalId}`, {
            method: 'DELETE'
        });
        
        await loadGoals();
        showToast('Meta excluída com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao excluir meta:', error);
        showToast('Erro ao excluir meta', 'error');
    }
}

async function updateGoalProgress(goalId, newAmount) {
    try {
        await apiCall(`/api/goals/${goalId}`, {
            method: 'PUT',
            body: JSON.stringify({ current_amount: newAmount })
        });
        
        await loadGoals();
        showToast('Progresso atualizado!', 'success');
    } catch (error) {
        console.error('Erro ao atualizar progresso:', error);
        showToast('Erro ao atualizar progresso', 'error');
    }
}

async function toggleGoalStatus(goalId, newStatus) {
    try {
        await apiCall(`/api/goals/${goalId}`, {
            method: 'PUT',
            body: JSON.stringify({ status: newStatus })
        });
        
        await loadGoals();
        showToast('Status da meta atualizado!', 'success');
    } catch (error) {
        console.error('Erro ao atualizar status:', error);
        showToast('Erro ao atualizar status', 'error');
    }
}

// Display Functions
function displayGoals(filteredGoals = goals) {
    const container = document.getElementById('goalsContainer');
    if (!container) return;

    if (filteredGoals.length === 0) {
        container.innerHTML = `
            <div class="text-center" style="grid-column: 1 / -1; padding: 3rem;">
                <h3 style="color: var(--text-secondary); margin-bottom: 1rem;">Nenhuma meta encontrada</h3>
                <p style="color: var(--text-secondary); margin-bottom: 2rem;">Comece criando sua primeira meta financeira!</p>
                <button onclick="openGoalModal()" class="btn-primary">+ Criar Meta</button>
            </div>
        `;
        return;
    }

    container.innerHTML = filteredGoals.map(goal => createGoalCard(goal)).join('');
}

function displayGoalsPreview() {
    const container = document.getElementById('goalsPreviewContainer');
    if (!container) return;
    const activeGoals = goals.filter(goal => goal.status === 'ativa').slice(0, 3);

    if (activeGoals.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'grid';
    container.innerHTML = activeGoals.map(goal => createGoalCard(goal, true)).join('');
}

function createGoalCard(goal, isPreview = false) {
    const progress = calculateProgress(goal);
    const daysRemaining = calculateDaysRemaining(goal.deadline || goal.target_date);
    const isOverdue = daysRemaining < 0;
    const isNearDeadline = daysRemaining <= 7 && daysRemaining >= 0;
    const goalName = goal.name || goal.title || 'Meta';
    const statusClass = goal.status === 'ativa' ? 'active' : goal.status === 'concluida' ? 'completed' : 'paused';

    return `
        <div class="goal-card ${isPreview ? 'goal-preview' : ''}">
            <div class="goal-header">
                <div>
                    <h3 class="goal-title">${escapeHtml(goalName)}</h3>
                    <span class="goal-type ${goal.goal_type || ''}">${getGoalTypeLabel(goal.goal_type)}</span>
                </div>
                <span class="goal-status ${statusClass}">${getStatusLabel(goal.status)}</span>
            </div>

            ${goal.description ? `<p class="goal-description">${escapeHtml(goal.description)}</p>` : ''}

            <div class="goal-progress">
                <div class="goal-amounts">
                    <span class="goal-current">R$ ${formatCurrency(goal.current_amount || 0)}</span>
                    <span class="goal-target">/ R$ ${formatCurrency(goal.target_amount)}</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${Math.min(progress, 100)}%"></div>
                </div>
                <div class="progress-percentage">${progress.toFixed(1)}% concluído</div>
            </div>

            <div class="goal-date">
                <span class="goal-date-label">Data alvo:</span>
                <span class="goal-date-value ${isOverdue ? 'text-danger' : isNearDeadline ? 'text-warning' : ''}">
                    ${formatDate(goal.deadline || goal.target_date)}
                    ${isOverdue ? '(Vencida)' : isNearDeadline ? `(${daysRemaining} dias)` : ''}
                </span>
            </div>

            ${!isPreview ? `
                <div class="goal-actions">
                    <button onclick="editGoal('${goal._id}')" class="btn-secondary btn-sm">Editar</button>
                    <button onclick="updateProgress('${goal._id}')" class="btn-primary btn-sm">Atualizar</button>
                    ${goal.status === 'ativa' ?
                        `<button onclick="toggleGoalStatus('${goal._id}', 'concluida')" class="btn-secondary btn-sm">Concluir</button>` :
                        `<button onclick="toggleGoalStatus('${goal._id}', 'ativa')" class="btn-secondary btn-sm">Reativar</button>`
                    }
                    <button onclick="deleteGoal('${goal._id}')" class="btn-danger btn-sm">Excluir</button>
                </div>
            ` : ''}
        </div>
    `;
}

// Helper Functions
function calculateProgress(goal) {
    if (goal.goal_type === 'expense_limit') {
        // Para limite de gastos, o progresso é o quanto do limite foi utilizado
        return Math.min((goal.current_amount / goal.target_amount) * 100, 100);
    } else {
        // Para metas de economia e receita, o progresso é o quanto foi alcançado
        return Math.min((goal.current_amount / goal.target_amount) * 100, 100);
    }
}

function calculateDaysRemaining(targetDate) {
    const today = new Date();
    const target = new Date(targetDate);
    const diffTime = target - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function getGoalTypeLabel(type) {
    const labels = {
        'savings': 'Economia',
        'expense_limit': 'Limite de Gastos',
        'income': 'Receita'
    };
    return labels[type] || type;
}

function getStatusLabel(status) {
    const labels = {
        'active': 'Ativa',
        'completed': 'Concluída',
        'paused': 'Pausada'
    };
    return labels[status] || status;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR');
}

// Modal Functions
function openGoalModal() {
    // Clear form
    document.getElementById('goalForm').reset();
    document.getElementById('goalId').value = '';
    document.getElementById('goalModalTitle').textContent = 'Nova Meta';
    
    // Define a data mínima como hoje
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('goalTargetDate').min = today;
    
    // Update category select
    updateGoalCategorySelect();
    
    document.getElementById('goalModal').style.display = 'block';
}

function closeGoalModal() {
    document.getElementById('goalModal').style.display = 'none';
}

function editGoal(goalId) {
    const goal = goals.find(g => g._id === goalId);
    
    if (!goal) {
        showToast('Meta não encontrada', 'error');
        return;
    }

    // Fill form with goal data
    document.getElementById('goalId').value = goal._id;
    document.getElementById('goalTitle').value = goal.name || goal.title || '';
    document.getElementById('goalDescription').value = goal.description || '';
    document.getElementById('goalType').value = goal.goal_type;
    document.getElementById('goalTargetAmount').value = goal.target_amount;
    document.getElementById('goalCurrentAmount').value = goal.current_amount || 0;
    document.getElementById('goalTargetDate').value = goal.deadline || goal.target_date || '';
    document.getElementById('goalCategory').value = goal.category_id || '';
    
    document.getElementById('goalModalTitle').textContent = 'Editar Meta';
    document.getElementById('goalModal').style.display = 'block';
}

function updateProgress(goalId) {
    const goal = goals.find(g => g._id === goalId);
    if (!goal) return;

    const newAmount = prompt(
        `Atualizar progresso da meta "${escapeHtml(goal.name || goal.title)}":\nValor atual: R$ ${formatCurrency(goal.current_amount || 0)}\nNovo valor:`,
        goal.current_amount || 0
    );

    if (newAmount !== null && !isNaN(newAmount)) {
        updateGoalProgress(goalId, parseFloat(newAmount));
    }
}

function updateGoalCategorySelect() {
    const select = document.getElementById('goalCategory');
    if (!select) return;
    select.innerHTML = '<option value="">Sem categoria</option>';
    if (typeof categories !== 'undefined') {
        categories.forEach(category => {
            const option = new Option(escapeHtml(category.name), category._id);
            select.add(option);
        });
    }
}

function handleGoalTypeChange() {
    const goalType = document.getElementById('goalType');
    const categoryGroup = document.getElementById('goalCategoryGroup');
    if (!goalType || !categoryGroup) return;

    if (goalType.value === 'expense_limit') {
        categoryGroup.style.display = 'block';
    } else {
        categoryGroup.style.display = 'none';
        const cat = document.getElementById('goalCategory');
        if (cat) cat.value = '';
    }
}

// Filter Functions
function filterGoals() {
    const statusFilter = document.getElementById('goalStatusFilter').value;
    const typeFilter = document.getElementById('goalTypeFilter').value;

    let filtered = goals.filter(goal => {
        const matchesStatus = !statusFilter || goal.status === statusFilter;
        const matchesType = !typeFilter || goal.goal_type === typeFilter;
        
        return matchesStatus && matchesType;
    });

    displayGoals(filtered);
}

// Alert Functions
function checkGoalAlerts() {
    const alertContainer = document.getElementById('goalAlerts');
    if (!alertContainer) return;
    let alerts = [];

    goals.forEach(goal => {
        if (goal.status !== 'ativa') return;

        const progress = calculateProgress(goal);
        const daysRemaining = calculateDaysRemaining(goal.target_date);

        if (progress >= 100) {
            alerts.push({ type: 'success', icon: '🎉', message: `Parabéns! Você atingiu a meta "${escapeHtml(goal.name)}"!` });
        } else if (progress >= 90) {
            alerts.push({ type: 'warning', icon: '🔥', message: `Quase lá! Meta "${escapeHtml(goal.name)}" está ${progress.toFixed(1)}% concluída.` });
        } else if (daysRemaining < 0) {
            alerts.push({ type: 'warning', icon: '⏰', message: `A meta "${escapeHtml(goal.name)}" está vencida há ${Math.abs(daysRemaining)} dias.` });
        } else if (daysRemaining <= 7) {
            alerts.push({ type: 'warning', icon: '⚠️', message: `A meta "${escapeHtml(goal.name)}" vence em ${daysRemaining} dias.` });
        }
    });

    alertContainer.innerHTML = alerts.map(alert => `
        <div class="goal-alert ${alert.type}">
            <span class="goal-alert-icon">${alert.icon}</span>
            <span class="goal-alert-text">${alert.message}</span>
        </div>
    `).join('');
}

// NOTE: showNotification é definida em dashboard.js (como sinônimo do
// sistema de toast estilizado via dashboard.css). Havia uma segunda
// definição aqui, nunca usada dentro deste arquivo, que só sobrescrevia
// silenciosamente a versão certa por ser carregada depois — removida.

// Auto-update goal progress based on transactions
function updateGoalProgressFromTransactions() {
    if (goals.length === 0 || transactions.length === 0) return;

    goals.forEach(goal => {
        if (goal.status !== 'active') return;

        let calculatedAmount = 0;
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM format

        switch (goal.goal_type) {
            case 'savings':
                // Calcula a economia total (receitas - despesas) do mês atual
                const monthlyTransactions = transactions.filter(t => t.month === currentMonth);
                const monthlyIncome = monthlyTransactions.reduce((sum, t) => sum + (t.income || 0), 0);
                const monthlyExpenses = monthlyTransactions.reduce((sum, t) => sum + (t.expense || 0), 0);
                calculatedAmount = monthlyIncome - monthlyExpenses;
                break;

            case 'expense_limit':
                // Calcula despesas da categoria específica se definida, ou todas as despesas
                let expenseTransactions = transactions.filter(t => t.month === currentMonth);
                if (goal.category_id) {
                    expenseTransactions = expenseTransactions.filter(t => t.category_id === goal.category_id);
                }
                calculatedAmount = expenseTransactions.reduce((sum, t) => sum + (t.expense || 0), 0);
                break;

            case 'income':
                // Calcula a receita total do mês atual
                const incomeTransactions = transactions.filter(t => t.month === currentMonth);
                calculatedAmount = incomeTransactions.reduce((sum, t) => sum + (t.income || 0), 0);
                break;
        }

        // Atualiza a meta se o valor calculado for diferente do valor atual
        if (Math.abs(calculatedAmount - (goal.current_amount || 0)) > 0.01) {
            updateGoalProgress(goal._id, calculatedAmount);
        }
    });
}

// goals.js não registra DOMContentLoaded — a inicialização é gerenciada pelo dashboard.js
