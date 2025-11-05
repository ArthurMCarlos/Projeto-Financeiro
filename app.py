from flask import Flask, request, jsonify, send_file, render_template_string
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import jwt
import pymongo
from pymongo import MongoClient
from bson import ObjectId
import os
from datetime import datetime, timedelta
import pandas as pd
import io
from reportlab.lib.pagesizes import letter, A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
import json

app = Flask(__name__)
# Configuration
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
CORS(app, origins=["*"])

# MongoDB Configuration
MONGODB_URI = os.environ.get('MONGODB_URI')
DATABASE_NAME = os.environ.get('DATABASE_NAME', 'financial_organizer')

# Initialize MongoDB connection
db = None
users_collection = None
transactions_collection = None
categories_collection = None
incomes_collection = None
budgets_collection = None
accounts_collection = None
goals_collection = None

if MONGODB_URI:
    try:
        client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')
        db = client[DATABASE_NAME]
        users_collection = db.users
        transactions_collection = db.transactions
        categories_collection = db.categories
        incomes_collection = db.incomes
        budgets_collection = db.budgets
        accounts_collection = db.accounts
        goals_collection = db.goals
        print("✅ Conectado ao MongoDB com sucesso!")
    except Exception as e:
        print(f"❌ Erro ao conectar ao MongoDB: {e}")
        print("⚠️ Usando armazenamento em memória")
else:
    print("⚠️ MONGODB_URI não configurado, usando armazenamento em memória")

# In-memory storage for development/fallback
memory_storage = {
    'users': [],
    'transactions': [],
    'categories': [],
    'incomes': [],
    'budgets': [],
    'accounts': [],
    'goals': []
}

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        
        if not token:
            return jsonify({'message': 'Token não fornecido'}), 401
        
        try:
            if token.startswith('Bearer '):
                token = token[7:]
            
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
            
            if db is not None:
                current_user = users_collection.find_one({'_id': ObjectId(current_user_id)})
            else:
                current_user = next((u for u in memory_storage['users'] if u['_id'] == current_user_id), None)
            
            if not current_user:
                return jsonify({'message': 'Usuário não encontrado'}), 401
                
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token expirado'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Token inválido'}), 401
        
        return f(current_user, *args, **kwargs)
    
    return decorated

# Helper functions
def serialize_doc(doc):
    if doc is None:
        return None
    
    if isinstance(doc, list):
        return [serialize_doc(item) for item in doc]
    
    if isinstance(doc, dict):
        result = {}
        for key, value in doc.items():
            if isinstance(value, ObjectId):
                result[key] = str(value)
            elif isinstance(value, datetime):
                result[key] = value.isoformat()
            else:
                result[key] = value
        return result
    
    return doc

def get_next_id():
    import uuid
    return str(uuid.uuid4())

def update_account_balance(user_id, account_id, amount_change):
    """
    Atualiza o saldo de uma conta específica
    
    Args:
        user_id (str): ID do usuário
        account_id (str): ID da conta
        amount_change (float): Mudança no valor (positivo para adicionar, negativo para subtrair)
    """
    if not account_id or amount_change == 0:
        return
    
    try:
        if db is not None:
            # Busca a conta atual para obter o saldo atual
            account = accounts_collection.find_one({
                '_id': ObjectId(account_id), 
                'user_id': user_id
            })
            
            if account:
                current_balance = account.get('balance', 0)
                new_balance = current_balance + amount_change
                
                accounts_collection.update_one(
                    {'_id': ObjectId(account_id), 'user_id': user_id},
                    {'$set': {'balance': new_balance, 'updated_at': datetime.utcnow()}}
                )
        else:
            account = next((a for a in memory_storage['accounts'] 
                           if a['_id'] == account_id and a['user_id'] == user_id), None)
            
            if account:
                account['balance'] = account.get('balance', 0) + amount_change
                account['updated_at'] = datetime.utcnow()
                
    except Exception as e:
        print(f"Erro ao atualizar saldo da conta: {e}")

def recalculate_account_balance(user_id, account_id):
    """
    Recalcula o saldo de uma conta baseado em todas as transações
    """
    if not account_id:
        return
    
    try:
        if db is not None:
            # Busca todas as transações da conta
            transactions = list(transactions_collection.find({
                'account_id': account_id,
                'user_id': user_id
            }))
            
            total_balance = 0
            for transaction in transactions:
                expense = transaction.get('expense', 0)
                income = transaction.get('income', 0)
                total_balance += income - expense
            
            accounts_collection.update_one(
                {'_id': ObjectId(account_id), 'user_id': user_id},
                {'$set': {'balance': total_balance, 'updated_at': datetime.utcnow()}}
            )
        else:
            transactions = [t for t in memory_storage['transactions'] 
                          if t.get('account_id') == account_id and t['user_id'] == user_id]
            
            total_balance = 0
            for transaction in transactions:
                expense = transaction.get('expense', 0)
                income = transaction.get('income', 0)
                total_balance += income - expense
            
            account = next((a for a in memory_storage['accounts'] 
                           if a['_id'] == account_id and a['user_id'] == user_id), None)
            
            if account:
                account['balance'] = total_balance
                account['updated_at'] = datetime.utcnow()
                
    except Exception as e:
        print(f"Erro ao recalcular saldo da conta: {e}")

def update_budget_amount(user_id, category_id, month, amount_change):
    """
    Atualiza automaticamente o orçamento de uma categoria específica
    
    Args:
        user_id (str): ID do usuário
        category_id (str): ID da categoria
        month (str): Mês no formato 'YYYY-MM'
        amount_change (float): Mudança no valor (positivo para adicionar, negativo para subtrair)
    """
    if not category_id or not month or amount_change == 0:
        return
    
    try:
        if db is not None:
            # Busca o orçamento atual da categoria para o mês
            budget = budgets_collection.find_one({
                'user_id': user_id,
                'category_id': category_id,
                'month': month
            })
            
            if budget:
                current_amount = budget.get('amount', 0)
                new_amount = current_amount + amount_change
                
                budgets_collection.update_one(
                    {'_id': budget['_id']},
                    {'$set': {'amount': new_amount, 'updated_at': datetime.utcnow()}}
                )
                
                print(f"✅ Orçamento atualizado: {current_amount} -> {new_amount} para categoria {category_id} no mês {month}")
            else:
                print(f"⚠️ Orçamento não encontrado para categoria {category_id} no mês {month}")
                
        else:
            budget = next((b for b in memory_storage['budgets'] 
                          if b['user_id'] == user_id and 
                             b['category_id'] == category_id and 
                             b['month'] == month), None)
            
            if budget:
                budget['amount'] = budget.get('amount', 0) + amount_change
                budget['updated_at'] = datetime.utcnow()
                
                print(f"✅ Orçamento atualizado (memória): {budget['amount']} para categoria {category_id} no mês {month}")
            else:
                print(f"⚠️ Orçamento não encontrado (memória) para categoria {category_id} no mês {month}")
                
    except Exception as e:
        print(f"Erro ao atualizar orçamento: {e}")

# Auth Routes
@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or not all(k in data for k in ['username', 'password']):
        return jsonify({'message': 'Dados incompletos'}), 400
    
    username = data['username']
    password = data['password']
    
    # Check if user already exists
    if db is not None:
        existing_user = users_collection.find_one({'username': username})
    else:
        existing_user = next((u for u in memory_storage['users'] if u['username'] == username), None)
    
    if existing_user:
        return jsonify({'message': 'Usuário já existe'}), 400
    
    # Create new user
    user_data = {
        'username': username,
        'password_hash': generate_password_hash(password),
        'created_at': datetime.utcnow()
    }
    
    if db is not None:
        result = users_collection.insert_one(user_data)
        user_id = str(result.inserted_id)
    else:
        user_id = get_next_id()
        user_data['_id'] = user_id
        memory_storage['users'].append(user_data)
    
    return jsonify({'message': 'Usuário criado com sucesso', 'user_id': user_id}), 201

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or not all(k in data for k in ['username', 'password']):
        return jsonify({'message': 'Dados incompletos'}), 400
    
    username = data['username']
    password = data['password']
    
    # Find user
    if db is not None:
        user = users_collection.find_one({'username': username})
    else:
        user = next((u for u in memory_storage['users'] if u['username'] == username), None)
    
    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'message': 'Credenciais inválidas'}), 401
    
    # Generate token
    token = jwt.encode({
        'user_id': str(user['_id']),
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({
        'token': token,
        'user': {
            'id': str(user['_id']),
            'username': user['username']
        }
    })

@app.route('/api/auth/verify', methods=['GET'])
@token_required
def verify_token(current_user):
    return jsonify({
        'user': {
            'id': str(current_user['_id']),
            'username': current_user['username']
        }
    })

# Categories Routes
@app.route('/api/categories', methods=['GET'])
@token_required
def get_categories(current_user):
    user_id = str(current_user['_id'])
    
    if db is not None:
        categories = list(categories_collection.find({'user_id': user_id}))
    else:
        categories = [c for c in memory_storage['categories'] if c['user_id'] == user_id]
    
    return jsonify({'categories': serialize_doc(categories)})

@app.route('/api/categories', methods=['POST'])
@token_required
def create_category(current_user):
    data = request.get_json()
    
    required_fields = ['name', 'type']
    if not data or not all(k in data for k in required_fields):
        return jsonify({'message': 'Dados incompletos'}), 400
    
    user_id = str(current_user['_id'])
    
    category_data = {
        'name': data['name'],
        'type': data['type'],
        'user_id': user_id,
        'created_at': datetime.utcnow()
    }
    
    if db is not None:
        result = categories_collection.insert_one(category_data)
        category_id = str(result.inserted_id)
    else:
        category_id = get_next_id()
        category_data['_id'] = category_id
        memory_storage['categories'].append(category_data)
    
    return jsonify({'message': 'Categoria criada com sucesso', 'id': category_id}), 201

@app.route('/api/categories/<category_id>', methods=['PUT'])
@token_required
def update_category(current_user, category_id):
    data = request.get_json()
    user_id = str(current_user['_id'])
    
    update_data = {}
    for field in ['name', 'type']:
        if field in data:
            update_data[field] = data[field]
    
    update_data['updated_at'] = datetime.utcnow()
    
    if db is not None:
        result = categories_collection.update_one(
            {'_id': ObjectId(category_id), 'user_id': user_id},
            {'$set': update_data}
        )
        
        if result.matched_count == 0:
            return jsonify({'message': 'Categoria não encontrada'}), 404
    else:
        category = next((c for c in memory_storage['categories'] 
                        if c['_id'] == category_id and c['user_id'] == user_id), None)
        
        if not category:
            return jsonify({'message': 'Categoria não encontrada'}), 404
        
        category.update(update_data)
    
    return jsonify({'message': 'Categoria atualizada com sucesso'})

@app.route('/api/categories/<category_id>', methods=['DELETE'])
@token_required
def delete_category(current_user, category_id):
    user_id = str(current_user['_id'])
    
    if db is not None:
        result = categories_collection.delete_one({
            '_id': ObjectId(category_id),
            'user_id': user_id
        })
        
        if result.deleted_count == 0:
            return jsonify({'message': 'Categoria não encontrada'}), 404
    else:
        category = next((c for c in memory_storage['categories'] 
                        if c['_id'] == category_id and c['user_id'] == user_id), None)
        
        if not category:
            return jsonify({'message': 'Categoria não encontrada'}), 404
        
        memory_storage['categories'].remove(category)
    
    return jsonify({'message': 'Categoria excluída com sucesso'})

# Accounts Routes
@app.route('/api/accounts', methods=['GET'])
@token_required
def get_accounts(current_user):
    user_id = str(current_user['_id'])
    
    if db is not None:
        accounts = list(accounts_collection.find({'user_id': user_id}))
    else:
        accounts = [a for a in memory_storage['accounts'] if a['user_id'] == user_id]
    
    return jsonify({'accounts': serialize_doc(accounts)})

@app.route('/api/accounts', methods=['POST'])
@token_required
def create_account(current_user):
    data = request.get_json()
    
    required_fields = ['name', 'type']
    if not data or not all(k in data for k in required_fields):
        return jsonify({'message': 'Dados incompletos'}), 400
    
    user_id = str(current_user['_id'])
    
    account_data = {
        'name': data['name'],
        'type': data['type'],
        'balance': float(data.get('balance', 0)),
        'user_id': user_id,
        'created_at': datetime.utcnow()
    }
    
    if db is not None:
        result = accounts_collection.insert_one(account_data)
        account_id = str(result.inserted_id)
    else:
        account_id = get_next_id()
        account_data['_id'] = account_id
        memory_storage['accounts'].append(account_data)
    
    return jsonify({'message': 'Conta criada com sucesso', 'id': account_id}), 201

@app.route('/api/accounts/<account_id>', methods=['PUT'])
@token_required
def update_account(current_user, account_id):
    data = request.get_json()
    user_id = str(current_user['_id'])
    
    update_data = {}
    for field in ['name', 'type', 'balance']:
        if field in data:
            if field == 'balance':
                update_data[field] = float(data[field])
            else:
                update_data[field] = data[field]
    
    update_data['updated_at'] = datetime.utcnow()
    
    if db is not None:
        result = accounts_collection.update_one(
            {'_id': ObjectId(account_id), 'user_id': user_id},
            {'$set': update_data}
        )
        
        if result.matched_count == 0:
            return jsonify({'message': 'Conta não encontrada'}), 404
    else:
        account = next((a for a in memory_storage['accounts'] 
                       if a['_id'] == account_id and a['user_id'] == user_id), None)
        
        if not account:
            return jsonify({'message': 'Conta não encontrada'}), 404
        
        account.update(update_data)
    
    return jsonify({'message': 'Conta atualizada com sucesso'})

@app.route('/api/accounts/<account_id>', methods=['DELETE'])
@token_required
def delete_account(current_user, account_id):
    user_id = str(current_user['_id'])
    
    if db is not None:
        result = accounts_collection.delete_one({
            '_id': ObjectId(account_id),
            'user_id': user_id
        })
        
        if result.deleted_count == 0:
            return jsonify({'message': 'Conta não encontrada'}), 404
    else:
        account = next((a for a in memory_storage['accounts'] 
                       if a['_id'] == account_id and a['user_id'] == user_id), None)
        
        if not account:
            return jsonify({'message': 'Conta não encontrada'}), 404
        
        memory_storage['accounts'].remove(account)
    
    return jsonify({'message': 'Conta excluída com sucesso'})

# Transactions Routes
@app.route('/api/transactions', methods=['GET'])
@token_required
def get_transactions(current_user):
    user_id = str(current_user['_id'])
    month = request.args.get('month')
    
    if db is not None:
        query = {'user_id': user_id}
        if month:
            query['month'] = month
        transactions = list(transactions_collection.find(query))
    else:
        transactions = [t for t in memory_storage['transactions'] if t['user_id'] == user_id]
        if month:
            transactions = [t for t in transactions if t['month'] == month]
    
    return jsonify({'transactions': serialize_doc(transactions)})

@app.route('/api/transactions', methods=['POST'])
@token_required
def create_transaction(current_user):
    data = request.get_json()
    
    required_fields = ['month', 'reason', 'category_id']
    if not data or not all(k in data for k in required_fields):
        return jsonify({'message': 'Dados incompletos'}), 400
    
    user_id = str(current_user['_id'])
    
    transaction_data = {
        'month': data['month'],
        'reason': data['reason'],
        'expense': float(data.get('expense', 0)),
        'current_value': float(data.get('current_value', 0)),
        'category_id': data['category_id'],
        'income': float(data.get('income', 0)),
        'account_id': data.get('account_id'),
        'user_id': user_id,
        'created_at': datetime.utcnow()
    }
    
    if db is not None:
        result = transactions_collection.insert_one(transaction_data)
        transaction_id = str(result.inserted_id)
    else:
        transaction_id = get_next_id()
        transaction_data['_id'] = transaction_id
        memory_storage['transactions'].append(transaction_data)
    
    # Atualiza o saldo da conta se foi vinculada uma conta
    if data.get('account_id'):
        expense = float(data.get('expense', 0))
        income = float(data.get('income', 0))
        net_change = income - expense  # Receitas adicionam, despesas subtraem
        update_account_balance(user_id, data['account_id'], net_change)
    
    # ✅ NOVA FUNCIONALIDADE: Atualiza automaticamente o orçamento
    expense = float(data.get('expense', 0))
    if expense > 0:
        category_id = data['category_id']
        month = data['month']
        # Diminui o orçamento pelo valor da despesa
        update_budget_amount(user_id, category_id, month, -expense)
    
    return jsonify({'message': 'Transação criada com sucesso', 'id': transaction_id}), 201

@app.route('/api/transactions/<transaction_id>', methods=['PUT'])
@token_required
def update_transaction(current_user, transaction_id):
    data = request.get_json()
    user_id = str(current_user['_id'])
    
    # Busca a transação original para comparar valores
    if db is not None:
        original_transaction = transactions_collection.find_one({
            '_id': ObjectId(transaction_id), 
            'user_id': user_id
        })
    else:
        original_transaction = next((t for t in memory_storage['transactions'] 
                                   if t['_id'] == transaction_id and t['user_id'] == user_id), None)
    
    if not original_transaction:
        return jsonify({'message': 'Transação não encontrada'}), 404
    
    update_data = {}
    for field in ['month', 'reason', 'expense', 'current_value', 'category_id', 'income', 'account_id']:
        if field in data:
            if field in ['expense', 'current_value', 'income']:
                update_data[field] = float(data[field])
            else:
                update_data[field] = data[field]
    
    update_data['updated_at'] = datetime.utcnow()
    
    # ✅ CORREÇÃO DE ORÇAMENTO: Calcula a diferença de despesa para ajustar orçamento
    old_expense = original_transaction.get('expense', 0)
    new_expense = update_data.get('expense', old_expense)
    
    if db is not None:
        result = transactions_collection.update_one(
            {'_id': ObjectId(transaction_id), 'user_id': user_id},
            {'$set': update_data}
        )
        
        if result.matched_count == 0:
            return jsonify({'message': 'Transação não encontrada'}), 404
    else:
        transaction = next((t for t in memory_storage['transactions'] 
                          if t['_id'] == transaction_id and t['user_id'] == user_id), None)
        
        if not transaction:
            return jsonify({'message': 'Transação não encontrada'}), 404
        
        transaction.update(update_data)
    
    # Se foi vinculado uma conta ou valores foram alterados, recalcula o saldo da conta
    if ('account_id' in update_data or 'expense' in update_data or 'income' in update_data):
        account_id = update_data.get('account_id')
        if account_id:
            recalculate_account_balance(user_id, account_id)
    
    # ✅ CORREÇÃO DE ORÇAMENTO: Ajusta orçamento baseado na diferença
    if old_expense != new_expense:
        old_category = original_transaction.get('category_id')
        new_category = update_data.get('category_id', old_category)
        old_month = original_transaction.get('month')
        new_month = update_data.get('month', old_month)
        
        # Reverte o orçamento original
        if old_expense > 0 and old_category and old_month:
            update_budget_amount(user_id, old_category, old_month, old_expense)
        
        # Aplica o novo orçamento
        if new_expense > 0 and new_category and new_month:
            update_budget_amount(user_id, new_category, new_month, -new_expense)
    
    return jsonify({'message': 'Transação atualizada com sucesso'})

@app.route('/api/transactions/<transaction_id>', methods=['DELETE'])
@token_required
def delete_transaction(current_user, transaction_id):
    user_id = str(current_user['_id'])
    
    # Busca a transação antes de excluir para ajustar orçamento
    if db is not None:
        transaction = transactions_collection.find_one({
            '_id': ObjectId(transaction_id),
            'user_id': user_id
        })
        
        if not transaction:
            return jsonify({'message': 'Transação não encontrada'}), 404
        
        result = transactions_collection.delete_one({
            '_id': ObjectId(transaction_id),
            'user_id': user_id
        })
        
        if result.deleted_count == 0:
            return jsonify({'message': 'Transação não encontrada'}), 404
    else:
        transaction = next((t for t in memory_storage['transactions'] 
                          if t['_id'] == transaction_id and t['user_id'] == user_id), None)
        
        if not transaction:
            return jsonify({'message': 'Transação não encontrada'}), 404
        
        memory_storage['transactions'].remove(transaction)
    
    # ✅ CORREÇÃO DE ORÇAMENTO: Reverte o orçamento quando a transação é excluída
    expense = transaction.get('expense', 0)
    category_id = transaction.get('category_id')
    month = transaction.get('month')
    
    if expense > 0 and category_id and month:
        # Adiciona de volta o valor ao orçamento (reverte a dedução)
        update_budget_amount(user_id, category_id, month, expense)
    
    return jsonify({'message': 'Transação excluída com sucesso'})

# Incomes Routes
@app.route('/api/incomes', methods=['GET'])
@token_required
def get_incomes(current_user):
    user_id = str(current_user['_id'])
    month = request.args.get('month')
    
    if db is not None:
        query = {'user_id': user_id}
        if month:
            query['month'] = month
        incomes = list(incomes_collection.find(query))
    else:
        incomes = [i for i in memory_storage['incomes'] if i['user_id'] == user_id]
        if month:
            incomes = [i for i in incomes if i['month'] == month]
    
    return jsonify({'incomes': serialize_doc(incomes)})

@app.route('/api/incomes', methods=['POST'])
@token_required
def create_income(current_user):
    data = request.get_json()
    
    required_fields = ['amount', 'source', 'month']
    if not data or not all(k in data for k in required_fields):
        return jsonify({'message': 'Dados incompletos1'}), 400
    
    user_id = str(current_user['_id'])
    
    income_data = {
        'amount': float(data['amount']),
        'source': data['source'],
        'month': data['month'],
        'account_id': data.get('account_id'),
        'user_id': user_id,
        'created_at': datetime.utcnow()
    }
    
    if db is not None:
        result = incomes_collection.insert_one(income_data)
        income_id = str(result.inserted_id)
    else:
        income_id = get_next_id()
        income_data['_id'] = income_id
        memory_storage['incomes'].append(income_data)
    
    # Atualiza o saldo da conta se foi vinculada uma conta
    if data.get('account_id'):
        update_account_balance(user_id, data['account_id'], income_data['amount'])
    
    return jsonify({'message': 'Receita criada com sucesso', 'id': income_id}), 201

@app.route('/api/incomes/<income_id>', methods=['PUT'])
@token_required
def update_income(current_user, income_id):
    data = request.get_json()
    user_id = str(current_user['_id'])
    
    update_data = {}
    for field in ['amount', 'source', 'month', 'account_id']:
        if field in data:
            if field == 'amount':
                update_data[field] = float(data[field])
            else:
                update_data[field] = data[field]
    
    update_data['updated_at'] = datetime.utcnow()
    
    if db is not None:
        result = incomes_collection.update_one(
            {'_id': ObjectId(income_id), 'user_id': user_id},
            {'$set': update_data}
        )
        
        if result.matched_count == 0:
            return jsonify({'message': 'Receita não encontrada'}), 404
    else:
        income = next((i for i in memory_storage['incomes'] 
                      if i['_id'] == income_id and i['user_id'] == user_id), None)
        
        if not income:
            return jsonify({'message': 'Receita não encontrada'}), 404
        
        income.update(update_data)
    
    # Se foi vinculado uma conta ou valores foram alterados, recalcula o saldo da conta
    if ('account_id' in update_data or 'amount' in update_data):
        account_id = update_data.get('account_id')
        if account_id:
            recalculate_account_balance(user_id, account_id)
    
    return jsonify({'message': 'Receita atualizada com sucesso'})

@app.route('/api/incomes/<income_id>', methods=['DELETE'])
@token_required
def delete_income(current_user, income_id):
    user_id = str(current_user['_id'])
    
    if db is not None:
        result = incomes_collection.delete_one({
            '_id': ObjectId(income_id),
            'user_id': user_id
        })
        
        if result.deleted_count == 0:
            return jsonify({'message': 'Receita não encontrada'}), 404
    else:
        income = next((i for i in memory_storage['incomes'] 
                      if i['_id'] == income_id and i['user_id'] == user_id), None)
        
        if not income:
            return jsonify({'message': 'Receita não encontrada'}), 404
        
        memory_storage['incomes'].remove(income)
    
    return jsonify({'message': 'Receita excluída com sucesso'})

# Budgets Routes
@app.route('/api/budgets', methods=['GET'])
@token_required
def get_budgets(current_user):
    user_id = str(current_user['_id'])
    
    if db is not None:
        budgets = list(budgets_collection.find({'user_id': user_id}))
    else:
        budgets = [b for b in memory_storage['budgets'] if b['user_id'] == user_id]
    
    return jsonify({'budgets': serialize_doc(budgets)})

@app.route('/api/budgets', methods=['POST'])
@token_required
def create_budget(current_user):
    data = request.get_json()
    
    required_fields = ['category_id', 'amount', 'month']
    if not data or not all(k in data for k in required_fields):
        return jsonify({'message': 'Dados incompletos'}), 400
    
    user_id = str(current_user['_id'])
    
    budget_data = {
        'category_id': data['category_id'],
        'amount': float(data['amount']),
        'month': data['month'],
        'user_id': user_id,
        'created_at': datetime.utcnow()
    }
    
    if db is not None:
        result = budgets_collection.insert_one(budget_data)
        budget_id = str(result.inserted_id)
    else:
        budget_id = get_next_id()
        budget_data['_id'] = budget_id
        memory_storage['budgets'].append(budget_data)
    
    return jsonify({'message': 'Orçamento criado com sucesso', 'id': budget_id}), 201

@app.route('/api/budgets/<budget_id>', methods=['PUT'])
@token_required
def update_budget(current_user, budget_id):
    data = request.get_json()
    user_id = str(current_user['_id'])
    
    update_data = {}
    for field in ['category_id', 'amount', 'month']:
        if field in data:
            if field == 'amount':
                update_data[field] = float(data[field])
            else:
                update_data[field] = data[field]
    
    update_data['updated_at'] = datetime.utcnow()
    
    if db is not None:
        result = budgets_collection.update_one(
            {'_id': ObjectId(budget_id), 'user_id': user_id},
            {'$set': update_data}
        )
        
        if result.matched_count == 0:
            return jsonify({'message': 'Orçamento não encontrado'}), 404
    else:
        budget = next((b for b in memory_storage['budgets'] 
                      if b['_id'] == budget_id and b['user_id'] == user_id), None)
        
        if not budget:
            return jsonify({'message': 'Orçamento não encontrado'}), 404
        
        budget.update(update_data)
    
    return jsonify({'message': 'Orçamento atualizado com sucesso'})

@app.route('/api/budgets/<budget_id>', methods=['DELETE'])
@token_required
def delete_budget(current_user, budget_id):
    user_id = str(current_user['_id'])
    
    if db is not None:
        result = budgets_collection.delete_one({
            '_id': ObjectId(budget_id),
            'user_id': user_id
        })
        
        if result.deleted_count == 0:
            return jsonify({'message': 'Orçamento não encontrado'}), 404
    else:
        budget = next((b for b in memory_storage['budgets'] 
                      if b['_id'] == budget_id and b['user_id'] == user_id), None)
        
        if not budget:
            return jsonify({'message': 'Orçamento não encontrado'}), 404
        
        memory_storage['budgets'].remove(budget)
    
    return jsonify({'message': 'Orçamento excluído com sucesso'})

# Goals Routes
@app.route('/api/goals', methods=['GET'])
@token_required
def get_goals(current_user):
    user_id = str(current_user['_id'])
    
    if db is not None:
        goals = list(goals_collection.find({'user_id': user_id}))
    else:
        goals = [g for g in memory_storage['goals'] if g['user_id'] == user_id]
    
    return jsonify({'goals': serialize_doc(goals)})

@app.route('/api/goals', methods=['POST'])
@token_required
def create_goal(current_user):
    data = request.get_json()
    
    required_fields = ['name', 'target_amount', 'current_amount']
    if not data or not all(k in data for k in required_fields):
        return jsonify({'message': 'Dados incompletos'}), 400
    
    user_id = str(current_user['_id'])
    
    goal_data = {
        'name': data['name'],
        'target_amount': float(data['target_amount']),
        'current_amount': float(data['current_amount']),
        'category_id': data.get('category_id'),
        'deadline': data.get('deadline'),
        'user_id': user_id,
        'created_at': datetime.utcnow()
    }
    
    if db is not None:
        result = goals_collection.insert_one(goal_data)
        goal_id = str(result.inserted_id)
    else:
        goal_id = get_next_id()
        goal_data['_id'] = goal_id
        memory_storage['goals'].append(goal_data)
    
    return jsonify({'message': 'Meta criada com sucesso', 'id': goal_id}), 201

@app.route('/api/goals/<goal_id>', methods=['PUT'])
@token_required
def update_goal(current_user, goal_id):
    data = request.get_json()
    user_id = str(current_user['_id'])
    
    update_data = {}
    for field in ['name', 'target_amount', 'current_amount', 'category_id', 'deadline']:
        if field in data:
            if field in ['target_amount', 'current_amount']:
                update_data[field] = float(data[field])
            else:
                update_data[field] = data[field]
    
    update_data['updated_at'] = datetime.utcnow()
    
    if db is not None:
        result = goals_collection.update_one(
            {'_id': ObjectId(goal_id), 'user_id': user_id},
            {'$set': update_data}
        )
        
        if result.matched_count == 0:
            return jsonify({'message': 'Meta não encontrada'}), 404
    else:
        goal = next((g for g in memory_storage['goals'] 
                    if g['_id'] == goal_id and g['user_id'] == user_id), None)
        
        if not goal:
            return jsonify({'message': 'Meta não encontrada'}), 404
        
        goal.update(update_data)
    
    return jsonify({'message': 'Meta atualizada com sucesso'})

@app.route('/api/goals/<goal_id>', methods=['DELETE'])
@token_required
def delete_goal(current_user, goal_id):
    user_id = str(current_user['_id'])
    
    if db is not None:
        result = goals_collection.delete_one({
            '_id': ObjectId(goal_id),
            'user_id': user_id
        })
        
        if result.deleted_count == 0:
            return jsonify({'message': 'Meta não encontrada'}), 404
    else:
        goal = next((g for g in memory_storage['goals'] 
                    if g['_id'] == goal_id and g['user_id'] == user_id), None)
        
        if not goal:
            return jsonify({'message': 'Meta não encontrada'}), 404
        
        memory_storage['goals'].remove(goal)
    
    return jsonify({'message': 'Meta excluída com sucesso'})

# Reports Routes
@app.route('/api/reports/pdf', methods=['POST'])
@token_required
def generate_pdf_report(current_user):
    data = request.get_json()
    user_id = str(current_user['_id'])
    
    month = data.get('month')
    if not month:
        return jsonify({'message': 'Mês é obrigatório'}), 400
    
    try:
        # Get transactions for the month
        if db is not None:
            transactions = list(transactions_collection.find({
                'user_id': user_id,
                'month': month
            }))
        else:
            transactions = [t for t in memory_storage['transactions'] 
                          if t['user_id'] == user_id and t['month'] == month]
        
        # Get categories
        if db is not None:
            categories = {str(c['_id']): c for c in categories_collection.find({'user_id': user_id})}
        else:
            categories = {c['_id']: c for c in memory_storage['categories'] 
                         if c['user_id'] == user_id}
        
        # Create PDF
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4)
        story = []
        styles = getSampleStyleSheet()
        
        # Title
        title = Paragraph(f"Relatório Financeiro - {month}", styles['Title'])
        story.append(title)
        story.append(Spacer(1, 20))
        
        # Transactions table
        if transactions:
            table_data = [['Data', 'Categoria', 'Descrição', 'Despesa', 'Receita']]
            for transaction in transactions:
                category_name = categories.get(transaction['category_id'], {}).get('name', 'Desconhecida')
                expense = f"R$ {transaction.get('expense', 0):.2f}" if transaction.get('expense', 0) > 0 else '-'
                income = f"R$ {transaction.get('income', 0):.2f}" if transaction.get('income', 0) > 0 else '-'
                
                table_data.append([
                    transaction.get('month', ''),
                    category_name,
                    transaction.get('reason', ''),
                    expense,
                    income
                ])
            
            table = Table(table_data)
            table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 14),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
                ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
                ('GRID', (0, 0), (-1, -1), 1, colors.black)
            ]))
            
            story.append(table)
        else:
            story.append(Paragraph("Nenhuma transação encontrada para este período.", styles['Normal']))
        
        doc.build(story)
        buffer.seek(0)
        
        return send_file(
            buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=f'relatorio_{month}.pdf'
        )
        
    except Exception as e:
        return jsonify({'message': f'Erro ao gerar relatório: {str(e)}'}), 500

@app.route('/api/reports/excel', methods=['POST'])
@token_required
def generate_excel_report(current_user):
    data = request.get_json()
    user_id = str(current_user['_id'])
    
    month = data.get('month')
    if not month:
        return jsonify({'message': 'Mês é obrigatório'}), 400
    
    try:
        # Get transactions for the month
        if db is not None:
            transactions = list(transactions_collection.find({
                'user_id': user_id,
                'month': month
            }))
        else:
            transactions = [t for t in memory_storage['transactions'] 
                          if t['user_id'] == user_id and t['month'] == month]
        
        # Create DataFrame
        df_data = []
        for transaction in transactions:
            df_data.append({
                'Data': transaction.get('month', ''),
                'Categoria': transaction.get('category_id', ''),
                'Descrição': transaction.get('reason', ''),
                'Despesa': transaction.get('expense', 0),
                'Receita': transaction.get('income', 0),
                'Conta': transaction.get('account_id', '')
            })
        
        df = pd.DataFrame(df_data)
        
        # Create Excel file
        buffer = io.BytesIO()
        with pd.ExcelWriter(buffer, engine='xlsxwriter') as writer:
            df.to_excel(writer, sheet_name='Transações', index=False)
            
            # Get categories and replace IDs with names
            if db is not None:
                categories = {str(c['_id']): c['name'] for c in categories_collection.find({'user_id': user_id})}
                accounts = {str(a['_id']): a['name'] for a in accounts_collection.find({'user_id': user_id})}
            else:
                categories = {c['_id']: c['name'] for c in memory_storage['categories'] 
                             if c['user_id'] == user_id}
                accounts = {a['_id']: a['name'] for a in memory_storage['accounts'] 
                           if a['user_id'] == user_id}
            
            # Replace category and account IDs with names
            df_excel = df.copy()
            df_excel['Categoria'] = df_excel['Categoria'].map(categories).fillna('Desconhecida')
            df_excel['Conta'] = df_excel['Conta'].map(accounts).fillna('Não especificada')
            
            df_excel.to_excel(writer, sheet_name='Transações', index=False)
        
        buffer.seek(0)
        
        return send_file(
            buffer,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=f'relatorio_{month}.xlsx'
        )
        
    except Exception as e:
        return jsonify({'message': f'Erro ao gerar relatório: {str(e)}'}), 500

# Serve dashboard (for development)
@app.route('/')
def serve_dashboard():
    return render_template_string("""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Sistema de Organização Financeira</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body>
        <h1>Sistema de Organização Financeira</h1>
        <p>O servidor está funcionando! Acesse o dashboard em: <code>/dashboard.html</code></p>
        <p>Para desenvolvimento, coloque os arquivos HTML na pasta do projeto.</p>
    </body>
    </html>
    """)

if __name__ == '__main__':
    print("🚀 Iniciando Sistema de Organização Financeira...")
    print("📊 Funcionalidade de Orçamento Automático Ativada!")
    print("✅ Quando uma despesa for adicionada, o orçamento será automaticamente diminuído")
    
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
