// Goals management functionality

let goals = [];

// Initialize goals functionality
async function initializeGoals() {
    await loadGoals();
    initializeGoalEventListeners();
}

function initializeGoalEventListeners() {
    // Add goal button
    document.getElementById('addGoalBtn').addEventListener('click', () => {
        openGoalModal();
    });

    // Goal filters
    document.getElementById('goalStatusFilter').addEventListener('change', filterGoals);
    document.getElementById('goalTypeFilter').addEventListener('change', filterGoals);

    // Goal form
    document.getElementById('goalForm').addEventListener('submit', saveGoal);

    // Goal type change handler
    document.getElementById('goalType').addEventListener('change', handleGoalTypeChange);
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
    
    const formData = new FormData(event.target);
    const goalId = document.getElementById('goalId').value;
    
    const goalData = {
        title: document.getElementById('goalTitle').value,
        description: document.getElementById('goalDescription').value,
        goal_type: document.getElementById('goalType').value,
        target_amount: parseFloat(document.getElementById('goalTargetAmount').value),
        current_amount: parseFloat(document.getElementById('goalCurrentAmount').value) || 0,
        target_date: document.getElementById('goalTargetDate').value,
        category_id: document.getElementById('goalCategory').value || null
    };

    try {
        if (goalId) {
            // Update existing goal
            await apiCall(`/api/goals/${goalId}`, {
                method: 'PUT',
                body: JSON.stringify(goalData)
            });
        } else {
            // Create new goal
            await apiCall('/api/goals', {
                method: 'POST',
                body: JSON.stringify(goalData)
            });
        }
        
        closeGoalModal();
        await loadGoals();
        showNotification('Meta salva com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao salvar meta:', error);
        showNotification('Erro ao salvar meta', 'error');
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
        showNotification('Meta excluída com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao excluir meta:', error);
        showNotification('Erro ao excluir meta', 'error');
    }
}

async function updateGoalProgress(goalId, newAmount) {
    try {
        await apiCall(`/api/goals/${goalId}`, {
            method: 'PUT',
            body: JSON.stringify({ current_amount: newAmount })
        });
        
        await loadGoals();
        showNotification('Progresso atualizado!', 'success');
    } catch (error) {
        console.error('Erro ao atualizar progresso:', error);
        showNotification('Erro ao atualizar progresso', 'error');
    }
}

async function toggleGoalStatus(goalId, newStatus) {
    try {
        await apiCall(`/api/goals/${goalId}`, {
            method: 'PUT',
            body: JSON.stringify({ status: newStatus })
        });
        
        await loadGoals();
        showNotification('Status da meta atualizado!', 'success');
    } catch (error) {
        console.error('Erro ao atualizar status:', error);
        showNotification('Erro ao atualizar status', 'error');
    }
}

// Display Functions
function displayGoals(filteredGoals = goals) {
    const container = document.getElementById('goalsContainer');
    
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
    const activeGoals = goals.filter(goal => goal.status === 'active').slice(0, 3);
    
    if (activeGoals.length === 0) {
        container.innerHTML = `
            <div class="text-center" style="grid-column: 1 / -1; padding: 2rem;">
                <p style="color: var(--text-secondary);">Nenhuma meta ativa no momento.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = activeGoals.map(goal => createGoalCard(goal, true)).join('');
}

function createGoalCard(goal, isPreview = false) {
    const progress = calculateProgress(goal);
    const daysRemaining = calculateDaysRemaining(goal.target_date);
    const isOverdue = daysRemaining < 0;
    const isNearDeadline = daysRemaining <= 7 && daysRemaining >= 0;
    
    return `
        <div class="goal-card ${isPreview ? 'goal-preview' : ''}">
            <div class="goal-header">
                <div>
                    <h3 class="goal-title">${goal.title}</h3>
                    <span class="goal-type ${goal.goal_type}">${getGoalTypeLabel(goal.goal_type)}</span>
                </div>
                <span class="goal-status ${goal.status}">${getStatusLabel(goal.status)}</span>
            </div>
            
            ${goal.description ? `<p class="goal-description">${goal.description}</p>` : ''}
            
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
                    ${formatDate(goal.target_date)}
                    ${isOverdue ? '(Vencida)' : isNearDeadline ? `(${daysRemaining} dias)` : ''}
                </span>
            </div>
            
            ${!isPreview ? `
                <div class="goal-actions">
                    <button onclick="editGoal('${goal._id}')" class="btn-secondary">Editar</button>
                    <button onclick="updateProgress('${goal._id}')" class="btn-primary">Atualizar</button>
                    ${goal.status === 'active' ? 
                        `<button onclick="toggleGoalStatus('${goal._id}', 'completed')" class="btn-secondary">Concluir</button>` :
                        `<button onclick="toggleGoalStatus('${goal._id}', 'active')" class="btn-secondary">Reativar</button>`
                    }
                    <button onclick="deleteGoal('${goal._id}')" class="btn-danger">Excluir</button>
                </div>
            ` : ''}
        </div>
    `;
}

// Helper Functions
function calculateProgress(goal) {
    if (goal.goal_type === 'expense_limit') {
        // For expense limits, progress is how much of the limit has been used
        return Math.min((goal.current_amount / goal.target_amount) * 100, 100);
    } else {
        // For savings and income goals, progress is how much has been achieved
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
    
    // Set minimum date to today
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
        showNotification('Meta não encontrada', 'error');
        return;
    }

    // Fill form with goal data
    document.getElementById('goalId').value = goal._id;
    document.getElementById('goalTitle').value = goal.title;
    document.getElementById('goalDescription').value = goal.description || '';
    document.getElementById('goalType').value = goal.goal_type;
    document.getElementById('goalTargetAmount').value = goal.target_amount;
    document.getElementById('goalCurrentAmount').value = goal.current_amount || 0;
    document.getElementById('goalTargetDate').value = goal.target_date;
    document.getElementById('goalCategory').value = goal.category_id || '';
    
    document.getElementById('goalModalTitle').textContent = 'Editar Meta';
    document.getElementById('goalModal').style.display = 'block';
}

function updateProgress(goalId) {
    const goal = goals.find(g => g._id === goalId);
    if (!goal) return;

    const newAmount = prompt(
        `Atualizar progresso da meta "${goal.title}":\nValor atual: R$ ${formatCurrency(goal.current_amount || 0)}\nNovo valor:`,
        goal.current_amount || 0
    );

    if (newAmount !== null && !isNaN(newAmount)) {
        updateGoalProgress(goalId, parseFloat(newAmount));
    }
}

function updateGoalCategorySelect() {
    const select = document.getElementById('goalCategory');
    select.innerHTML = '<option value="">Selecione uma categoria (opcional)</option>';
    
    categories.forEach(category => {
        const option = new Option(category.name, category._id);
        select.add(option);
    });
}

function handleGoalTypeChange() {
    const goalType = document.getElementById('goalType').value;
    const categoryGroup = document.getElementById('goalCategoryGroup');
    
    // Show category selection only for expense_limit goals
    if (goalType === 'expense_limit') {
        categoryGroup.style.display = 'block';
    } else {
        categoryGroup.style.display = 'none';
        document.getElementById('goalCategory').value = '';
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
    const alertContainer = document.getElementById('goalsPreviewContainer');
    let alerts = [];

    goals.forEach(goal => {
        if (goal.status !== 'active') return;

        const progress = calculateProgress(goal);
        const daysRemaining = calculateDaysRemaining(goal.target_date);

        // Check for completion
        if (progress >= 100) {
            alerts.push({
                type: 'success',
                icon: '🎉',
                message: `Parabéns! Você atingiu a meta "${goal.title}"!`
            });
        }
        // Check for near completion (90%+)
        else if (progress >= 90) {
            alerts.push({
                type: 'warning',
                icon: '🔥',
                message: `Você está quase lá! Meta "${goal.title}" está ${progress.toFixed(1)}% concluída.`
            });
        }
        // Check for overdue goals
        else if (daysRemaining < 0) {
            alerts.push({
                type: 'warning',
                icon: '⏰',
                message: `A meta "${goal.title}" está vencida há ${Math.abs(daysRemaining)} dias.`
            });
        }
        // Check for goals near deadline
        else if (daysRemaining <= 7) {
            alerts.push({
                type: 'warning',
                icon: '⚠️',
                message: `A meta "${goal.title}" vence em ${daysRemaining} dias.`
            });
        }
    });

    // Display alerts
    if (alerts.length > 0) {
        const alertsHtml = alerts.map(alert => `
            <div class="goal-alert ${alert.type}">
                <span class="goal-alert-icon">${alert.icon}</span>
                <span class="goal-alert-text">${alert.message}</span>
            </div>
        `).join('');

        // Insert alerts before the goals preview
        const existingAlerts = document.querySelector('.goals-alerts');
        if (existingAlerts) {
            existingAlerts.remove();
        }

        const alertsDiv = document.createElement('div');
        alertsDiv.className = 'goals-alerts';
        alertsDiv.innerHTML = alertsHtml;
        alertContainer.parentNode.insertBefore(alertsDiv, alertContainer);
    }
}

// Notification Function
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Auto-update goal progress based on transactions
function updateGoalProgressFromTransactions() {
    if (goals.length === 0 || transactions.length === 0) return;

    goals.forEach(goal => {
        if (goal.status !== 'active') return;

        let calculatedAmount = 0;
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM format

        switch (goal.goal_type) {
            case 'savings':
                // Calculate total savings (income - expenses) for current month
                const monthlyTransactions = transactions.filter(t => t.month === currentMonth);
                const monthlyIncome = monthlyTransactions.reduce((sum, t) => sum + (t.income || 0), 0);
                const monthlyExpenses = monthlyTransactions.reduce((sum, t) => sum + (t.expense || 0), 0);
                calculatedAmount = monthlyIncome - monthlyExpenses;
                break;

            case 'expense_limit':
                // Calculate expenses for specific category if set, or all expenses
                let expenseTransactions = transactions.filter(t => t.month === currentMonth);
                if (goal.category_id) {
                    expenseTransactions = expenseTransactions.filter(t => t.category_id === goal.category_id);
                }
                calculatedAmount = expenseTransactions.reduce((sum, t) => sum + (t.expense || 0), 0);
                break;

            case 'income':
                // Calculate total income for current month
                const incomeTransactions = transactions.filter(t => t.month === currentMonth);
                calculatedAmount = incomeTransactions.reduce((sum, t) => sum + (t.income || 0), 0);
                break;
        }

        // Update goal if calculated amount is different from current amount
        if (Math.abs(calculatedAmount - (goal.current_amount || 0)) > 0.01) {
            updateGoalProgress(goal._id, calculatedAmount);
        }
    });
}

// Initialize goals when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Initialize goals after a short delay to ensure other components are loaded
    setTimeout(initializeGoals, 500);
});