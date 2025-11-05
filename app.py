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
                
                # Atualiza o saldo da conta
                accounts_collection.update_one(
                    {'_id': ObjectId(account_id), 'user_id': user_id},
                    {'$set': {
                        'balance': new_balance,
                        'updated_at': datetime.utcnow()
                    }}
                )
        else:
            # Para armazenamento em memória
            account = next((a for a in memory_storage['accounts'] 
                           if a['_id'] == account_id and a['user_id'] == user_id), None)
            
            if account:
                current_balance = account.get('balance', 0)
                account['balance'] = current_balance + amount_change
                account['updated_at'] = datetime.utcnow()
                
    except Exception as e:
        print(f"Erro ao atualizar saldo da conta {account_id}: {e}")

def recalculate_account_balance(user_id, account_id):
    """
    Recalcula completamente o saldo de uma conta baseado em todas as transações e receitas
    
    Args:
        user_id (str): ID do usuário
        account_id (str): ID da conta
    """
    if not account_id:
        return
    
    try:
        total_change = 0
        
        if db is not None:
            # Calcula receitas vinculadas à conta
            incomes_cursor = incomes_collection.find({
                'user_id': user_id,
                'account_id': account_id
            })
            
            for income in incomes_cursor:
                total_change += income.get('amount', 0)
            
            # Calcula transações (receitas e despesas) vinculadas à conta
            transactions_cursor = transactions_collection.find({
                'user_id': user_id,
                'account_id': account_id
            })
            
            for transaction in transactions_cursor:
                total_change += transaction.get('income', 0)  # Adiciona receitas das transações
                total_change -= transaction.get('expense', 0)  # Subtrai despesas das transações
            
            # Atualiza o saldo da conta
            accounts_collection.update_one(
                {'_id': ObjectId(account_id), 'user_id': user_id},
                {'$set': {
                    'balance': total_change,
                    'updated_at': datetime.utcnow()
                }}
            )
        else:
            # Para armazenamento em memória
            incomes = [i for i in memory_storage['incomes'] 
                      if i['user_id'] == user_id and i.get('account_id') == account_id]
            transactions = [t for t in memory_storage['transactions'] 
                           if t['user_id'] == user_id and t.get('account_id') == account_id]
            
            for income in incomes:
                total_change += income.get('amount', 0)
            
            for transaction in transactions:
                total_change += transaction.get('income', 0)
                total_change -= transaction.get('expense', 0)
            
            account = next((a for a in memory_storage['accounts'] 
                           if a['_id'] == account_id and a['user_id'] == user_id), None)
            
            if account:
                account['balance'] = total_change
                account['updated_at'] = datetime.utcnow()
                
    except Exception as e:
        print(f"Erro ao recalcular saldo da conta {account_id}: {e}")

# Routes
@app.route('/')
def index():
    db_status = db is not None
    return render_template_string("""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Organização Financeira - API</title>
        <style>
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                margin: 0; padding: 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh; color: white;
            }
            .container { max-width: 800px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 40px; }
            .header h1 { font-size: 3rem; margin-bottom: 10px; }
            .header p { font-size: 1.2rem; opacity: 0.9; }
            .status { 
                background: rgba(255,255,255,0.1); padding: 30px; border-radius: 15px; 
                margin: 20px 0; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.2);
            }
            .success { border-left: 5px solid #4ade80; }
            .btn { 
                display: inline-block; background: rgba(255,255,255,0.2); 
                color: white; padding: 15px 30px; text-decoration: none; 
                border-radius: 50px; margin: 10px; transition: all 0.3s;
                border: 2px solid rgba(255,255,255,0.3);
            }
            .btn:hover { 
                background: rgba(255,255,255,0.3); 
                transform: translateY(-2px); box-shadow: 0 10px 25px rgba(0,0,0,0.2);
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>💰 Organização Financeira</h1>
                <p>API Backend - Sistema Completo de Gestão Financeira</p>
            </div>
            
            <div class="status success">
                <h3>✅ API Online e Funcionando</h3>
                <p>Backend Flask rodando com sucesso!</p>
                <div style="text-align: center;">
                    <a href="/login.html" class="btn">🔐 Acessar Sistema</a>
                </div>
            </div>
        </div>
    </body>
    </html>
    """, db_connected=db_status)

# Authentication Routes
@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or not all(k in data for k in ('name', 'email', 'password')):
        return jsonify({'message': 'Dados incompletos'}), 400
    
    if db is not None:
        existing_user = users_collection.find_one({'email': data['email']})
    else:
        existing_user = next((u for u in memory_storage['users'] if u['email'] == data['email']), None)
    
    if existing_user:
        return jsonify({'message': 'Email já cadastrado'}), 409
    
    user_data = {
        'name': data['name'],
        'email': data['email'],
        'password': generate_password_hash(data['password']),
        'created_at': datetime.utcnow()
    }
    
    if db is not None:
        result = users_collection.insert_one(user_data)
        user_id = str(result.inserted_id)
    else:
        user_id = get_next_id()
        user_data['_id'] = user_id
        memory_storage['users'].append(user_data)
    
    # Create default categories
    default_categories = [
        {'name': 'Alimentação', 'description': 'Gastos com comida e bebidas'},
        {'name': 'Transporte', 'description': 'Combustível, transporte público, manutenção de veículo'},
        {'name': 'Moradia', 'description': 'Aluguel, contas de luz, água, internet'},
        {'name': 'Saúde', 'description': 'Medicamentos, consultas médicas, planos de saúde'},
        {'name': 'Educação', 'description': 'Cursos, livros, material escolar'},
        {'name': 'Lazer', 'description': 'Entretenimento, hobbies, viagens'},
        {'name': 'Roupas', 'description': 'Vestuário e acessórios'},
        {'name': 'Outros', 'description': 'Demais gastos não categorizados'}
    ]
    
    for category_info in default_categories:
        category_data = {
            'name': category_info['name'],
            'description': category_info.get('description', ''),
            'user_id': user_id,
            'created_at': datetime.utcnow()
        }
        
        if db is not None:
            categories_collection.insert_one(category_data)
        else:
            category_data['_id'] = get_next_id()
            memory_storage['categories'].append(category_data)
    
    # Create default account
    default_account = {
        'name': 'Conta Principal',
        'type': 'corrente',
        'balance': 0,
        'user_id': user_id,
        'created_at': datetime.utcnow()
    }
    
    if db is not None:
        accounts_collection.insert_one(default_account)
    else:
        default_account['_id'] = get_next_id()
        memory_storage['accounts'].append(default_account)
    
    return jsonify({'message': 'Usuário cadastrado com sucesso'}), 201

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or not all(k in data for k in ('email', 'password')):
        return jsonify({'message': 'Email e senha são obrigatórios'}), 400
    
    if db is not None:
        user = users_collection.find_one({'email': data['email']})
    else:
        user = next((u for u in memory_storage['users'] if u['email'] == data['email']), None)
    
    if not user or not check_password_hash(user['password'], data['password']):
        return jsonify({'message': 'Email ou senha inválidos'}), 401
    
    token = jwt.encode({
        'user_id': str(user['_id']),
        'exp': datetime.utcnow() + timedelta(days=7)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({
        'token': token,
        'user': {
            'id': str(user['_id']),
            'name': user['name'],
            'email': user['email']
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
    
    if not data or 'name' not in data:
        return jsonify({'message': 'Nome da categoria é obrigatório'}), 400
    
    user_id = str(current_user['_id'])
    
    # Verifica se já existe uma categoria com o mesmo nome para o usuário
    if db is not None:
        existing_category = categories_collection.find_one({
            'name': data['name'], 
            'user_id': user_id
        })
    else:
        existing_category = next((c for c in memory_storage['categories'] 
                                if c['name'] == data['name'] and c['user_id'] == user_id), None)
    
    if existing_category:
        return jsonify({'message': 'Já existe uma categoria com este nome'}), 409
    
    category_data = {
        'name': data['name'],
        'description': data.get('description', ''),
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
    
    if not data:
        return jsonify({'message': 'Nenhum dado fornecido'}), 400
    
    # Verifica se já existe outra categoria com o mesmo nome para o usuário
    if 'name' in data:
        if db is not None:
            existing_category = categories_collection.find_one({
                'name': data['name'],
                'user_id': user_id,
                '_id': {'$ne': ObjectId(category_id)}  # Exclui a categoria atual da busca
            })
        else:
            existing_category = next((c for c in memory_storage['categories'] 
                                    if c['name'] == data['name'] and 
                                       c['user_id'] == user_id and 
                                       c['_id'] != category_id), None)
        
        if existing_category:
            return jsonify({'message': 'Já existe uma categoria com este nome'}), 409
    
    update_data = {}
    for field in ['name', 'description']:
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
@app.route('/api/categories/<category_id>', methods=['DELETE'])
@token_required
def delete_category(current_user, category_id):
    user_id = str(current_user['_id'])
    
    # Verifica se a categoria está sendo usada em transações
    if db is not None:
        transactions_using_category = transactions_collection.count_documents({
            'category_id': category_id,
            'user_id': user_id
        })
        budgets_using_category = budgets_collection.count_documents({
            'category_id': category_id,
            'user_id': user_id
        })
    else:
        transactions_using_category = len([t for t in memory_storage['transactions'] 
                                         if t['category_id'] == category_id and t['user_id'] == user_id])
        budgets_using_category = len([b for b in memory_storage['budgets'] 
                                    if b['category_id'] == category_id and b['user_id'] == user_id])
    
    if transactions_using_category > 0 or budgets_using_category > 0:
        return jsonify({
            'message': f'Não é possível excluir esta categoria. Ela está sendo usada em {transactions_using_category} transações e {budgets_using_category} orçamentos.'
        }), 400
    
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

# Transactions Routes
@app.route('/api/transactions', methods=['GET'])
@token_required
def get_transactions(current_user):
    user_id = str(current_user['_id'])
    
    if db is not None:
        transactions = list(transactions_collection.find({'user_id': user_id}).sort('month', -1))
    else:
        transactions = [t for t in memory_storage['transactions'] if t['user_id'] == user_id]
        transactions.sort(key=lambda x: x.get('month', ''), reverse=True)
    
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
    
    return jsonify({'message': 'Transação criada com sucesso', 'id': transaction_id}), 201

@app.route('/api/transactions/<transaction_id>', methods=['PUT'])
@token_required
def update_transaction(current_user, transaction_id):
    data = request.get_json()
    user_id = str(current_user['_id'])
    
    update_data = {}
    for field in ['month', 'reason', 'expense', 'current_value', 'category_id', 'income', 'account_id']:
        if field in data:
            if field in ['expense', 'current_value', 'income']:
                update_data[field] = float(data[field])
            else:
                update_data[field] = data[field]
    
    update_data['updated_at'] = datetime.utcnow()
    
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
    
    return jsonify({'message': 'Transação atualizada com sucesso'})

@app.route('/api/transactions/<transaction_id>', methods=['DELETE'])
@token_required
def delete_transaction(current_user, transaction_id):
    user_id = str(current_user['_id'])
    
    if db is not None:
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
        
        # Atualiza o saldo da conta se a transação tinha uma conta vinculada
        if transaction.get('account_id'):
            expense = transaction.get('expense', 0)
            income = transaction.get('income', 0)
            net_change = -(income - expense)  # Inverte o cálculo para subtração
            update_account_balance(user_id, transaction['account_id'], net_change)
        
        memory_storage['transactions'].remove(transaction)

        # Para MongoDB, precisa buscar a transação primeiro para obter o account_id
        if db is not None:
            transaction = transactions_collection.find_one({
                '_id': ObjectId(transaction_id),
                'user_id': user_id
            })
            
            if transaction and transaction.get('account_id'):
                expense = transaction.get('expense', 0)
                income = transaction.get('income', 0)
                net_change = -(income - expense)
                update_account_balance(user_id, transaction['account_id'], net_change)
    
    return jsonify({'message': 'Transação excluída com sucesso'})

# Incomes Routes
@app.route('/api/incomes', methods=['GET'])
@token_required
def get_incomes(current_user):
    user_id = str(current_user['_id'])
    
    if db is not None:
        incomes = list(incomes_collection.find({'user_id': user_id}).sort('month', -1))
    else:
        incomes = [i for i in memory_storage['incomes'] if i['user_id'] == user_id]
        incomes.sort(key=lambda x: x.get('month', ''), reverse=True)
    
    return jsonify({'incomes': serialize_doc(incomes)})

@app.route('/api/incomes', methods=['POST'])
@token_required
def create_income(current_user):
    data = request.get_json()
    
    required_fields = ['month', 'source', 'amount']
    if not data or not all(k in data for k in required_fields):
        return jsonify({'message': 'Dados incompletos'}), 400
    
    user_id = str(current_user['_id'])
    
    income_data = {
        'month': data['month'],
        'source': data['source'],
        'amount': float(data['amount']),
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
        update_account_balance(user_id, data['account_id'], float(data['amount']))
    
    return jsonify({'message': 'Receita criada com sucesso', 'id': income_id}), 201

@app.route('/api/incomes/<income_id>', methods=['PUT'])
@token_required
def update_income(current_user, income_id):
    data = request.get_json()
    user_id = str(current_user['_id'])
    
    update_data = {}
    for field in ['month', 'source', 'amount', 'account_id']:
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
    
    # Se foi vinculado uma conta, recalcula o saldo da conta
    if 'account_id' in update_data or 'amount' in update_data:
        if 'account_id' in update_data and 'amount' in update_data:
            # Se ambos mudaram, precisa recalcular a conta completa
            account_id = update_data['account_id']
            if account_id:
                recalculate_account_balance(user_id, account_id)
        elif 'amount' in update_data:
            # Só o valor mudou, precisa recalcular para obter o valor atualizado
            account_id = update_data.get('account_id')
            if account_id:
                recalculate_account_balance(user_id, account_id)
        elif 'account_id' in update_data:
            # Só a conta mudou, recalcula ambas
            new_account_id = update_data['account_id']
            if new_account_id:
                recalculate_account_balance(user_id, new_account_id)
    
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
        
        # Atualiza o saldo da conta se a receita tinha uma conta vinculada
        if income.get('account_id'):
            update_account_balance(user_id, income['account_id'], -float(income.get('amount', 0)))
        
        memory_storage['incomes'].remove(income)

        # Para MongoDB, precisa buscar a receita primeiro para obter o account_id
        if db is not None:
            income = incomes_collection.find_one({
                '_id': ObjectId(income_id),
                'user_id': user_id
            })
            
            if income and income.get('account_id'):
                update_account_balance(user_id, income['account_id'], -float(income.get('amount', 0)))
    
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
    
    required_fields = ['name', 'target_amount', 'deadline']
    if not data or not all(k in data for k in required_fields):
        return jsonify({'message': 'Dados incompletos'}), 400
    
    user_id = str(current_user['_id'])
    
    goal_data = {
        'name': data['name'],
        'target_amount': float(data['target_amount']),
        'current_amount': float(data.get('current_amount', 0)),
        'deadline': data['deadline'],
        'status': 'ativa',
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
    for field in ['name', 'target_amount', 'current_amount', 'deadline', 'status']:
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

# Statistics Route
@app.route('/api/stats')
def get_stats():
    if db is not None:
        total_users = users_collection.count_documents({})
        total_transactions = transactions_collection.count_documents({})
        total_categories = categories_collection.count_documents({})
    else:
        total_users = len(memory_storage['users'])
        total_transactions = len(memory_storage['transactions'])
        total_categories = len(memory_storage['categories'])
    
    return jsonify({
        'status': 'online',
        'database': 'MongoDB Atlas' if db is not None else 'Memory Storage',
        'total_users': total_users,
        'total_transactions': total_transactions,
        'total_categories': total_categories,
        'version': '2.0.0'
    })

# Export Routes
@app.route('/api/export/<format>', methods=['GET'])
@token_required
def export_data(current_user, format):
    user_id = str(current_user['_id'])
    
    if db is not None:
        transactions = list(transactions_collection.find({'user_id': user_id}))
        categories = list(categories_collection.find({'user_id': user_id}))
    else:
        transactions = [t for t in memory_storage['transactions'] if t['user_id'] == user_id]
        categories = [c for c in memory_storage['categories'] if c['user_id'] == user_id]
    
    category_lookup = {str(c['_id']): c['name'] for c in categories}
    
    export_data = []
    for t in transactions:
        export_data.append({
            'Mês': t.get('month', ''),
            'Motivo': t.get('reason', ''),
            'Valor Gasto (R$)': t.get('expense', 0),
            'Valor Atual (R$)': t.get('current_value', 0),
            'Categoria': category_lookup.get(str(t.get('category_id')), 'Sem categoria'),
            'Valor Recebido (R$)': t.get('income', 0)
        })
    
    if format == 'csv':
        df = pd.DataFrame(export_data)
        output = io.StringIO()
        df.to_csv(output, index=False, encoding='utf-8')
        output.seek(0)
        
        return send_file(
            io.BytesIO(output.getvalue().encode('utf-8')),
            mimetype='text/csv',
            as_attachment=True,
            download_name=f'financeiro_{datetime.now().strftime("%Y%m%d")}.csv'
        )
    
    elif format == 'excel':
        df = pd.DataFrame(export_data)
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, sheet_name='Transações', index=False)
        output.seek(0)
        
        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=f'financeiro_{datetime.now().strftime("%Y%m%d")}.xlsx'
        )
    
    else:
        return jsonify({'message': 'Formato não suportado'}), 400

# Import Route
@app.route('/api/import', methods=['POST'])
@token_required
def import_data(current_user):
    if 'file' not in request.files:
        return jsonify({'message': 'Nenhum arquivo enviado'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'message': 'Nenhum arquivo selecionado'}), 400
    
    user_id = str(current_user['_id'])
    
    try:
        if file.filename.endswith('.csv'):
            df = pd.read_csv(file)
        elif file.filename.endswith('.xlsx'):
            df = pd.read_excel(file)
        else:
            return jsonify({'message': 'Formato de arquivo não suportado'}), 400
        
        if db is not None:
            categories = list(categories_collection.find({'user_id': user_id}))
        else:
            categories = [c for c in memory_storage['categories'] if c['user_id'] == user_id]
        
        category_lookup = {c['name']: str(c['_id']) for c in categories}
        
        imported_count = 0
        
        for _, row in df.iterrows():
            try:
                category_name = row.get('Categoria', '')
                category_id = category_lookup.get(category_name)
                
                if not category_id:
                    category_data = {
                        'name': category_name,
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
                    
                    category_lookup[category_name] = category_id
                
                transaction_data = {
                    'month': str(row.get('Mês', '')),
                    'reason': str(row.get('Motivo', '')),
                    'expense': float(row.get('Valor Gasto (R$)', 0)),
                    'current_value': float(row.get('Valor Atual (R$)', 0)),
                    'category_id': category_id,
                    'income': float(row.get('Valor Recebido (R$)', 0)),
                    'user_id': user_id,
                    'created_at': datetime.utcnow()
                }
                
                if db is not None:
                    transactions_collection.insert_one(transaction_data)
                else:
                    transaction_data['_id'] = get_next_id()
                    memory_storage['transactions'].append(transaction_data)
                
                imported_count += 1
                
            except Exception as e:
                print(f"Erro ao importar linha: {e}")
                continue
        
        return jsonify({
            'message': 'Importação concluída',
            'imported': imported_count
        })
        
    except Exception as e:
        return jsonify({'message': f'Erro ao processar arquivo: {str(e)}'}), 400

# Static files serving
@app.route('/<path:filename>')
def serve_static(filename):
    try:
        if filename.endswith('.html'):
            with open(filename, 'r', encoding='utf-8') as f:
                return f.read()
        elif filename.endswith('.css'):
            with open(filename, 'r', encoding='utf-8') as f:
                return f.read(), 200, {'Content-Type': 'text/css'}
        elif filename.endswith('.js'):
            with open(filename, 'r', encoding='utf-8') as f:
                return f.read(), 200, {'Content-Type': 'application/javascript'}
        else:
            return "File not found", 404
    except FileNotFoundError:
        return "File not found", 404

# Health check endpoint
@app.route('/health')
def health_check():
    return jsonify({
        'status': 'healthy',
        'database': 'mongodb' if db is not None else 'memory',
        'timestamp': datetime.utcnow().isoformat()
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
