from flask import Flask, request, jsonify, send_file, render_template_string
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import jwt
import pymongo
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError, AutoReconnect
from bson import ObjectId
import os
from datetime import datetime, timedelta
import pandas as pd
import io
import time
import threading
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

# =====================================================
# GERENCIADOR DE CONEXÃO COM RECONEXÃO AUTOMÁTICA
# =====================================================

class MongoDBConnectionManager:
    """
    Gerenciador de conexões MongoDB com suporte a reconexão automática,
    pooling de conexões e mecanismos de keep-alive.
    """
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
            
        self.uri = MONGODB_URI
        self.db_name = DATABASE_NAME
        self._client = None
        self._db = None
        self._last_activity = 0
        self._connection_timeout = 5000
        self._socket_timeout = 10000
        self._max_pool_size = 10
        self._min_pool_size = 1
        self._max_idle_time_ms = 30000
        self._initialized = True
        
        self._connect()
    
    def _connect(self):
        """Estabelece conexão com o MongoDB Atlas com configurações otimizadas."""
        try:
            self._client = MongoClient(
                self.uri,
                serverSelectionTimeoutMS=self._connection_timeout,
                socketTimeoutMS=self._socket_timeout,
                maxPoolSize=self._max_pool_size,
                minPoolSize=self._min_pool_size,
                maxIdleTimeMS=self._max_idle_time_ms,
                waitQueueTimeoutMS=3000,
                retryWrites=True,
                retryReads=True,
                heartbeatFrequencyMS=5000,
                tls=True
            )
            
            # Teste de conexão imediata
            self._client.admin.command('ping')
            self._db = self._client[self.db_name]
            self._last_activity = time.time()
            print(f"✅ Conectado ao MongoDB com sucesso! Banco: {self.db_name}")
            
        except ConnectionFailure as e:
            print(f"❌ Erro ao conectar ao MongoDB: {e}")
            print("⚠️ Usando armazenamento em memória")
            self._db = None
    
    def _ensure_connection(self):
        """Garante que a conexão está ativa, reconectando se necessário."""
        current_time = time.time()
        
        # Verifica se passou muito tempo desde a última atividade
        time_since_activity = current_time - self._last_activity
        
        # Se passaram mais de 5 minutos, tenta reconectar
        if time_since_activity > 300:
            try:
                self._client.admin.command('ping')
                self._last_activity = current_time
            except (ConnectionFailure, ServerSelectionTimeoutError, AutoReconnect):
                print("🔄 Conexão perdida, reconectando...")
                self._reconnect()
        else:
            # Verificação rápida de conexão
            try:
                self._client.admin.command('ping')
            except (ConnectionFailure, ServerSelectionTimeoutError, AutoReconnect):
                print("🔄 Conexão instável, reconectando...")
                self._reconnect()
    
    def _reconnect(self):
        """Reconecta ao MongoDB de forma segura."""
        try:
            # Fecha conexão anterior se existir
            if self._client is not None:
                try:
                    self._client.close()
                except Exception:
                    pass
            
            # Estabelece nova conexão
            self._client = MongoClient(
                self.uri,
                serverSelectionTimeoutMS=self._connection_timeout,
                socketTimeoutMS=self._socket_timeout,
                maxPoolSize=self._max_pool_size,
                minPoolSize=self._min_pool_size,
                maxIdleTimeMS=self._max_idle_time_ms,
                waitQueueTimeoutMS=3000,
                retryWrites=True,
                retryReads=True,
                heartbeatFrequencyMS=5000,
                serverMonitoringMode='stream',
                tls=True
            )
            
            self._db = self._client[self.db_name]
            self._last_activity = time.time()
            print("✅ Reconexão realizada com sucesso")
            
        except Exception as e:
            print(f"❌ Erro durante reconexão: {e}")
            self._db = None
    
    @property
    def client(self):
        """Retorna o cliente MongoDB, garantindo conexão ativa."""
        if self._client is not None:
            self._ensure_connection()
        return self._client
    
    @property
    def db(self):
        """Retorna o banco de dados, garantindo conexão ativa."""
        if self._client is not None:
            self._ensure_connection()
        return self._db
    
    def update_activity(self):
        """Atualiza o timestamp de última atividade."""
        self._last_activity = time.time()
    
    def close(self):
        """Fecha a conexão de forma limpa."""
        if self._client is not None:
            self._client.close()
            self._client = None
            self._db = None


# Inicializa o gerenciador de conexões
db_manager = MongoDBConnectionManager()

# Atribui variáveis globais para compatibilidade
db = db_manager.db
users_collection = db.users if db is not None else None
transactions_collection = db.transactions if db is not None else None
categories_collection = db.categories if db is not None else None
incomes_collection = db.incomes if db is not None else None
budgets_collection = db.budgets if db is not None else None
accounts_collection = db.accounts if db is not None else None
goals_collection = db.goals if db is not None else None
credit_card_resets_collection = db.credit_card_resets if db is not None else None

# Criar coleção de transfers se não existir
if db is not None:
    try:
        transfers_collection = db.transfers
        # Verificar se a coleção existe, se não existir criar
        if 'transfers' not in db.list_collection_names():
            db.create_collection('transfers')
            print("✅ Coleção 'transfers' criada com sucesso")
    except Exception as e:
        print(f"⚠️ Erro ao acessar coleção transfers: {e}")
        transfers_collection = None
else:
    transfers_collection = None

# In-memory storage for development/fallback
memory_storage = {
    'users': [],
    'transactions': [],
    'categories': [],
    'incomes': [],
    'budgets': [],
    'accounts': [],
    'goals': [],
    'credit_card_resets': [],
    'transfers': []
}

# =====================================================
# DECORATOR PARA REQUISIÇÕES COM RETRY AUTOMÁTICO
# =====================================================

def with_connection_retry(max_retries=3, delay=0.5):
    """
    Decorator que adiciona lógica de retry automático para operações
    que podem falhar devido a perda de conexão.
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            last_exception = None
            
            for attempt in range(max_retries):
                try:
                    result = f(*args, **kwargs)
                    # Atualiza atividade após operação bem-sucedida
                    db_manager.update_activity()
                    return result
                    
                except (AutoReconnect, ConnectionFailure, ServerSelectionTimeoutError) as e:
                    last_exception = e
                    print(f"⚠️ Tentativa {attempt + 1}/{max_retries} falhou: {e}")
                    
                    if attempt < max_retries - 1:
                        # Espera exponencial antes de retry
                        wait_time = delay * (2 ** attempt)
                        time.sleep(wait_time)
                        
                        # Força reconexão
                        try:
                            db_manager._reconnect()
                            # Atualiza referências globais
                            global db, users_collection, transactions_collection
                            global categories_collection, incomes_collection, budgets_collection
                            global accounts_collection, goals_collection, credit_card_resets_collection
                            
                            db = db_manager.db
                            if db is not None:
                                users_collection = db.users
                                transactions_collection = db.transactions
                                categories_collection = db.categories
                                incomes_collection = db.incomes
                                budgets_collection = db.budgets
                                accounts_collection = db.accounts
                                goals_collection = db.goals
                                credit_card_resets_collection = db.credit_card_resets
                        except Exception:
                            pass
                    else:
                        print("❌ Todas as tentativas de reconexão falharam")
                        raise
            
            raise last_exception
        return decorated_function
    return decorator

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

            current_user = None
            if db_manager.db is not None:
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
    if not account_id or amount_change == 0:
        return

    try:
        if db_manager.db is not None:
            account = accounts_collection.find_one({
                '_id': ObjectId(account_id),
                'user_id': user_id
            })

            if account:
                # Se for cartão de crédito, usar lógica invertida
                if account.get('type') == 'cartao':
                    current_balance = account.get('balance', 0)
                    # Para cartão de crédito, o comportamento é o mesmo de contas normais:
                    # - expense (gastos) diminuem o limite (amount_change negativo)
                    # - income (pagamentos) aumentam o limite (amount_change positivo)
                    # A fórmula é simplesmente: atual + mudança
                    new_balance = current_balance + amount_change
                    
                    accounts_collection.update_one(
                        {'_id': ObjectId(account_id), 'user_id': user_id},
                        {'$set': {
                            'balance': new_balance,
                            'updated_at': datetime.utcnow()
                        }}
                    )
                    print(f"💳 Cartão atualizado: {account.get('name')} | Anterior: R$ {current_balance} | Novo: R$ {new_balance} | Mudança: R$ {amount_change}")
                else:
                    # Para outras contas, usar lógica normal (soma)
                    current_balance = account.get('balance', 0)
                    new_balance = current_balance + amount_change

                    accounts_collection.update_one(
                        {'_id': ObjectId(account_id), 'user_id': user_id},
                        {'$set': {
                            'balance': new_balance,
                            'updated_at': datetime.utcnow()
                        }}
                    )
        else:
            account = next((a for a in memory_storage['accounts']
                           if a['_id'] == account_id and a['user_id'] == user_id), None)

            if account:
                # Se for cartão de crédito, usar lógica específica
                if account.get('type') == 'cartao':
                    current_balance = account.get('balance', 0)
                    new_balance = current_balance + amount_change
                    account['balance'] = new_balance
                    account['updated_at'] = datetime.utcnow()
                    print(f"💳 Cartão atualizado (memory): {account.get('name')} | Anterior: R$ {current_balance} | Novo: R$ {new_balance}")
                else:
                    current_balance = account.get('balance', 0)
                    account['balance'] = current_balance + amount_change
                    account['updated_at'] = datetime.utcnow()

    except Exception as e:
        print(f"Erro ao atualizar saldo da conta {account_id}: {e}")

def recalculate_account_balance(user_id, account_id):
    if not account_id:
        return

    try:
        # Verificar se é um cartão de crédito - NÃO recalcular!
        if db_manager.db is not None:
            account_check = accounts_collection.find_one({
                '_id': ObjectId(account_id),
                'user_id': user_id
            })
        else:
            account_check = next((a for a in memory_storage['accounts']
                               if a['_id'] == account_id and a['user_id'] == user_id), None)
        
        # Se for cartão de crédito, não recalcular - o saldo já é gerenciado corretamente
        if account_check and account_check.get('type') == 'cartao':
            print(f"ℹ️ Pulando recalculo para cartão de crédito {account_id} - saldo gerenciado automaticamente")
            return
        
        total_change = 0

        if db_manager.db is not None:
            incomes_cursor = incomes_collection.find({
                'user_id': user_id,
                'account_id': account_id
            })

            for income in incomes_cursor:
                total_change += income.get('amount', 0)

            transactions_cursor = transactions_collection.find({
                'user_id': user_id,
                'account_id': account_id
            })

            for transaction in transactions_cursor:
                total_change += transaction.get('income', 0)
                total_change -= transaction.get('expense', 0)

            accounts_collection.update_one(
                {'_id': ObjectId(account_id), 'user_id': user_id},
                {'$set': {
                    'balance': total_change,
                    'updated_at': datetime.utcnow()
                }}
            )
        else:
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


# =====================================================
# FUNÇÕES DE RESET AUTOMÁTICO DE CARTÃO DE CRÉDITO
# =====================================================

def check_and_reset_credit_cards(user_id):
    today = datetime.utcnow().day
    reset_cards = []

    try:
        if db_manager.db is not None:
            credit_cards = list(accounts_collection.find({
                'user_id': user_id,
                'type': 'cartao',
                'closing_day': today
            }))

            for card in credit_cards:
                last_reset = card.get('last_reset_date')
                today_date = datetime.utcnow().date()

                if last_reset:
                    if isinstance(last_reset, datetime):
                        last_reset_date = last_reset.date()
                    else:
                        last_reset_date = datetime.fromisoformat(str(last_reset)).date()

                    if last_reset_date == today_date:
                        continue

                credit_limit = card.get('credit_limit', 0)
                old_balance = card.get('balance', 0)

                accounts_collection.update_one(
                    {'_id': card['_id']},
                    {'$set': {
                        'balance': credit_limit,
                        'last_reset_date': datetime.utcnow(),
                        'updated_at': datetime.utcnow()
                    }}
                )

                reset_record = {
                    'user_id': user_id,
                    'account_id': str(card['_id']),
                    'account_name': card.get('name', 'Cartão'),
                    'old_balance': old_balance,
                    'new_balance': credit_limit,
                    'credit_limit': credit_limit,
                    'reset_date': datetime.utcnow()
                }
                credit_card_resets_collection.insert_one(reset_record)

                reset_cards.append({
                    'id': str(card['_id']),
                    'name': card.get('name', 'Cartão'),
                    'old_balance': old_balance,
                    'new_balance': credit_limit,
                    'credit_limit': credit_limit
                })
        else:
            credit_cards = [a for a in memory_storage['accounts']
                           if a['user_id'] == user_id and
                           a['type'] == 'cartao' and
                           a.get('closing_day') == today]

            for card in credit_cards:
                last_reset = card.get('last_reset_date')
                today_date = datetime.utcnow().date()

                if last_reset:
                    if isinstance(last_reset, datetime):
                        last_reset_date = last_reset.date()
                    else:
                        last_reset_date = datetime.fromisoformat(str(last_reset)).date()

                    if last_reset_date == today_date:
                        continue

                credit_limit = card.get('credit_limit', 0)
                old_balance = card.get('balance', 0)

                card['balance'] = credit_limit
                card['last_reset_date'] = datetime.utcnow()
                card['updated_at'] = datetime.utcnow()

                reset_record = {
                    '_id': get_next_id(),
                    'user_id': user_id,
                    'account_id': card['_id'],
                    'account_name': card.get('name', 'Cartão'),
                    'old_balance': old_balance,
                    'new_balance': credit_limit,
                    'credit_limit': credit_limit,
                    'reset_date': datetime.utcnow()
                }
                memory_storage['credit_card_resets'].append(reset_record)

                reset_cards.append({
                    'id': card['_id'],
                    'name': card.get('name', 'Cartão'),
                    'old_balance': old_balance,
                    'new_balance': credit_limit,
                    'credit_limit': credit_limit
                })

    except Exception as e:
        print(f"Erro ao verificar reset de cartões: {e}")

    return reset_cards


def force_reset_credit_card(user_id, account_id):
    try:
        if db_manager.db is not None:
            card = accounts_collection.find_one({
                '_id': ObjectId(account_id),
                'user_id': user_id,
                'type': 'cartao'
            })

            if not card:
                return None

            credit_limit = card.get('credit_limit', 0)
            old_balance = card.get('balance', 0)

            # Calcular o saldo correto com base nas transações
            # Saldo do cartão = limite - gastos (ou limite + pagamentos)
            total_expenses = 0
            transactions_cursor = transactions_collection.find({
                'user_id': user_id,
                'account_id': account_id
            })
            for transaction in transactions_cursor:
                expense = transaction.get('expense', 0)
                income = transaction.get('income', 0)
                # net_change = income - expense, mas para o saldo do cartão é expense - income
                total_expenses += expense
                total_expenses -= income  # Pagamentos aumentam o limite disponível
            
            # O saldo correto é: limite - despesas + pagamentos
            correct_balance = credit_limit - total_expenses

            print(f"🔧 Correção de cartão: {card.get('name')}")
            print(f"   Limite: R$ {credit_limit}")
            print(f"   Total despesas: R$ {total_expenses}")
            print(f"   Saldo antigo: R$ {old_balance}")
            print(f"   Saldo correto: R$ {correct_balance}")

            accounts_collection.update_one(
                {'_id': ObjectId(account_id)},
                {'$set': {
                    'balance': correct_balance,
                    'last_reset_date': datetime.utcnow(),
                    'updated_at': datetime.utcnow()
                }}
            )

            reset_record = {
                'user_id': user_id,
                'account_id': account_id,
                'account_name': card.get('name', 'Cartão'),
                'old_balance': old_balance,
                'new_balance': correct_balance,
                'credit_limit': credit_limit,
                'reset_date': datetime.utcnow(),
                'manual': True
            }
            credit_card_resets_collection.insert_one(reset_record)

            return {
                'id': account_id,
                'name': card.get('name', 'Cartão'),
                'old_balance': old_balance,
                'new_balance': correct_balance,
                'credit_limit': credit_limit
            }
        else:
            card = next((a for a in memory_storage['accounts']
                        if a['_id'] == account_id and
                        a['user_id'] == user_id and
                        a['type'] == 'cartao'), None)

            if not card:
                return None

            credit_limit = card.get('credit_limit', 0)
            old_balance = card.get('balance', 0)

            # Calcular o saldo correto
            total_expenses = 0
            account_transactions = [t for t in memory_storage['transactions']
                                   if t['user_id'] == user_id and t.get('account_id') == account_id]
            for transaction in account_transactions:
                total_expenses += transaction.get('expense', 0)
                total_expenses -= transaction.get('income', 0)
            
            correct_balance = credit_limit - total_expenses

            card['balance'] = correct_balance
            card['last_reset_date'] = datetime.utcnow()
            card['updated_at'] = datetime.utcnow()

            return {
                'id': account_id,
                'name': card.get('name', 'Cartão'),
                'old_balance': old_balance,
                'new_balance': correct_balance,
                'credit_limit': credit_limit
            }

    except Exception as e:
        print(f"Erro ao forçar reset do cartão {account_id}: {e}")
        return None


# Routes
@app.route('/')
def index():
    db_status = db_manager.db is not None
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
                <p>Database: """ + ("MongoDB Atlas" if db_status else "Memory Storage") + """</p>
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
@with_connection_retry(max_retries=3)
def register():
    data = request.get_json()

    if not data or not all(k in data for k in ('name', 'email', 'password')):
        return jsonify({'message': 'Dados incompletos'}), 400

    if db_manager.db is not None:
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

    if db_manager.db is not None:
        result = users_collection.insert_one(user_data)
        user_id = str(result.inserted_id)
    else:
        user_id = get_next_id()
        user_data['_id'] = user_id
        memory_storage['users'].append(user_data)

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

        if db_manager.db is not None:
            categories_collection.insert_one(category_data)
        else:
            category_data['_id'] = get_next_id()
            memory_storage['categories'].append(category_data)

    default_account = {
        'name': 'Conta Principal',
        'type': 'corrente',
        'balance': 0,
        'user_id': user_id,
        'created_at': datetime.utcnow()
    }

    if db_manager.db is not None:
        accounts_collection.insert_one(default_account)
    else:
        default_account['_id'] = get_next_id()
        memory_storage['accounts'].append(default_account)

    return jsonify({'message': 'Usuário cadastrado com sucesso'}), 201

@app.route('/api/auth/login', methods=['POST'])
@with_connection_retry(max_retries=3)
def login():
    data = request.get_json()

    if not data or not all(k in data for k in ('email', 'password')):
        return jsonify({'message': 'Email e senha são obrigatórios'}), 400

    if db_manager.db is not None:
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
@with_connection_retry(max_retries=3)
def get_categories(current_user):
    user_id = str(current_user['_id'])

    if db_manager.db is not None:
        categories = list(categories_collection.find({'user_id': user_id}))
    else:
        categories = [c for c in memory_storage['categories'] if c['user_id'] == user_id]

    return jsonify({'categories': serialize_doc(categories)})

@app.route('/api/categories', methods=['POST'])
@token_required
@with_connection_retry(max_retries=3)
def create_category(current_user):
    data = request.get_json()

    if not data or 'name' not in data:
        return jsonify({'message': 'Nome da categoria é obrigatório'}), 400

    user_id = str(current_user['_id'])

    if db_manager.db is not None:
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

    if db_manager.db is not None:
        result = categories_collection.insert_one(category_data)
        category_id = str(result.inserted_id)
    else:
        category_id = get_next_id()
        category_data['_id'] = category_id
        memory_storage['categories'].append(category_data)

    return jsonify({'message': 'Categoria criada com sucesso', 'id': category_id}), 201

@app.route('/api/categories/<category_id>', methods=['PUT'])
@token_required
@with_connection_retry(max_retries=3)
def update_category(current_user, category_id):
    data = request.get_json()
    user_id = str(current_user['_id'])

    if not data:
        return jsonify({'message': 'Nenhum dado fornecido'}), 400

    if 'name' in data:
        if db_manager.db is not None:
            existing_category = categories_collection.find_one({
                'name': data['name'],
                'user_id': user_id,
                '_id': {'$ne': ObjectId(category_id)}
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

    if db_manager.db is not None:
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
@with_connection_retry(max_retries=3)
def delete_category(current_user, category_id):
    user_id = str(current_user['_id'])

    if db_manager.db is not None:
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

    if db_manager.db is not None:
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
@with_connection_retry(max_retries=3)
def get_transactions(current_user):
    user_id = str(current_user['_id'])

    if db_manager.db is not None:
        transactions = list(transactions_collection.find({'user_id': user_id}).sort('month', -1))
    else:
        transactions = [t for t in memory_storage['transactions'] if t['user_id'] == user_id]
        transactions.sort(key=lambda x: x.get('month', ''), reverse=True)

    return jsonify({'transactions': serialize_doc(transactions)})

@app.route('/api/transactions', methods=['POST'])
@token_required
@with_connection_retry(max_retries=3)
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

    if db_manager.db is not None:
        result = transactions_collection.insert_one(transaction_data)
        transaction_id = str(result.inserted_id)
    else:
        transaction_id = get_next_id()
        transaction_data['_id'] = transaction_id
        memory_storage['transactions'].append(transaction_data)

    if data.get('account_id'):
        expense = float(data.get('expense', 0))
        income = float(data.get('income', 0))
        net_change = income - expense
        update_account_balance(user_id, data['account_id'], net_change)

    return jsonify({'message': 'Transação criada com sucesso', 'id': transaction_id}), 201

@app.route('/api/transactions/<transaction_id>', methods=['PUT'])
@token_required
@with_connection_retry(max_retries=3)
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

    if db_manager.db is not None:
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

    if ('account_id' in update_data or 'expense' in update_data or 'income' in update_data):
        account_id = update_data.get('account_id')
        if account_id:
            # Verificar se a conta é um cartão de crédito antes de recalcular
            if db_manager.db is not None:
                account = accounts_collection.find_one({
                    '_id': ObjectId(account_id),
                    'user_id': user_id
                })
            else:
                account = next((a for a in memory_storage['accounts']
                               if a['_id'] == account_id and a['user_id'] == user_id), None)
            
            # Se for cartão de crédito, não recalcular
            if account and account.get('type') == 'cartao':
                print(f"ℹ️ Pulando recalculo para cartão de crédito ao editar transação")
            else:
                recalculate_account_balance(user_id, account_id)

    return jsonify({'message': 'Transação atualizada com sucesso'})

@app.route('/api/transactions/<transaction_id>', methods=['DELETE'])
@token_required
@with_connection_retry(max_retries=3)
def delete_transaction(current_user, transaction_id):
    user_id = str(current_user['_id'])

    if db_manager.db is not None:
        transaction = transactions_collection.find_one({
            '_id': ObjectId(transaction_id),
            'user_id': user_id
        })

        if not transaction:
            return jsonify({'message': 'Transação não encontrada'}), 404

        if transaction.get('account_id'):
            expense = transaction.get('expense', 0)
            income = transaction.get('income', 0)
            net_change = -(income - expense)
            update_account_balance(user_id, transaction['account_id'], net_change)

        result = transactions_collection.delete_one({
            '_id': ObjectId(transaction_id),
            'user_id': user_id
        })
    else:
        transaction = next((t for t in memory_storage['transactions']
                          if t['_id'] == transaction_id and t['user_id'] == user_id), None)

        if not transaction:
            return jsonify({'message': 'Transação não encontrada'}), 404

        if transaction.get('account_id'):
            expense = transaction.get('expense', 0)
            income = transaction.get('income', 0)
            net_change = -(income - expense)
            update_account_balance(user_id, transaction['account_id'], net_change)

        memory_storage['transactions'].remove(transaction)

    return jsonify({'message': 'Transação excluída com sucesso'})

# Incomes Routes
@app.route('/api/incomes', methods=['GET'])
@token_required
@with_connection_retry(max_retries=3)
def get_incomes(current_user):
    user_id = str(current_user['_id'])

    if db_manager.db is not None:
        incomes = list(incomes_collection.find({'user_id': user_id}).sort('month', -1))
    else:
        incomes = [i for i in memory_storage['incomes'] if i['user_id'] == user_id]
        incomes.sort(key=lambda x: x.get('month', ''), reverse=True)

    return jsonify({'incomes': serialize_doc(incomes)})

@app.route('/api/incomes', methods=['POST'])
@token_required
@with_connection_retry(max_retries=3)
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

    if db_manager.db is not None:
        result = incomes_collection.insert_one(income_data)
        income_id = str(result.inserted_id)
    else:
        income_id = get_next_id()
        income_data['_id'] = income_id
        memory_storage['incomes'].append(income_data)

    if data.get('account_id'):
        update_account_balance(user_id, data['account_id'], float(data['amount']))

    return jsonify({'message': 'Receita criada com sucesso', 'id': income_id}), 201

@app.route('/api/incomes/<income_id>', methods=['PUT'])
@token_required
@with_connection_retry(max_retries=3)
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

    if db_manager.db is not None:
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

    if 'account_id' in update_data or 'amount' in update_data:
        if 'account_id' in update_data and 'amount' in update_data:
            account_id = update_data['account_id']
            if account_id:
                # Verificar se é cartão de crédito
                if db_manager.db is not None:
                    account = accounts_collection.find_one({
                        '_id': ObjectId(account_id),
                        'user_id': user_id
                    })
                else:
                    account = next((a for a in memory_storage['accounts']
                                   if a['_id'] == account_id and a['user_id'] == user_id), None)
                
                if account and account.get('type') == 'cartao':
                    print(f"ℹ️ Pulando recalculo para cartão de crédito ao atualizar receita")
                else:
                    recalculate_account_balance(user_id, account_id)
        elif 'amount' in update_data:
            account_id = update_data.get('account_id')
            if account_id:
                # Verificar se é cartão de crédito
                if db_manager.db is not None:
                    account = accounts_collection.find_one({
                        '_id': ObjectId(account_id),
                        'user_id': user_id
                    })
                else:
                    account = next((a for a in memory_storage['accounts']
                                   if a['_id'] == account_id and a['user_id'] == user_id), None)
                
                if account and account.get('type') == 'cartao':
                    print(f"ℹ️ Pulando recalculo para cartão de crédito ao atualizar receita")
                else:
                    recalculate_account_balance(user_id, account_id)
        elif 'account_id' in update_data:
            new_account_id = update_data['account_id']
            if new_account_id:
                # Verificar se é cartão de crédito
                if db_manager.db is not None:
                    account = accounts_collection.find_one({
                        '_id': ObjectId(new_account_id),
                        'user_id': user_id
                    })
                else:
                    account = next((a for a in memory_storage['accounts']
                                   if a['_id'] == new_account_id and a['user_id'] == user_id), None)
                
                if account and account.get('type') == 'cartao':
                    print(f"ℹ️ Pulando recalculo para cartão de crédito ao atualizar receita")
                else:
                    recalculate_account_balance(user_id, new_account_id)

    return jsonify({'message': 'Receita atualizada com sucesso'})

@app.route('/api/incomes/<income_id>', methods=['DELETE'])
@token_required
@with_connection_retry(max_retries=3)
def delete_income(current_user, income_id):
    user_id = str(current_user['_id'])

    if db_manager.db is not None:
        income = incomes_collection.find_one({
            '_id': ObjectId(income_id),
            'user_id': user_id
        })

        if not income:
            return jsonify({'message': 'Receita não encontrada'}), 404

        if income.get('account_id'):
            update_account_balance(user_id, income['account_id'], -float(income.get('amount', 0)))

        result = incomes_collection.delete_one({
            '_id': ObjectId(income_id),
            'user_id': user_id
        })
    else:
        income = next((i for i in memory_storage['incomes']
                      if i['_id'] == income_id and i['user_id'] == user_id), None)

        if not income:
            return jsonify({'message': 'Receita não encontrada'}), 404

        if income.get('account_id'):
            update_account_balance(user_id, income['account_id'], -float(income.get('amount', 0)))

        memory_storage['incomes'].remove(income)

    return jsonify({'message': 'Receita excluída com sucesso'})

# Budgets Routes
@app.route('/api/budgets', methods=['GET'])
@token_required
@with_connection_retry(max_retries=3)
def get_budgets(current_user):
    user_id = str(current_user['_id'])

    if db_manager.db is not None:
        budgets = list(budgets_collection.find({'user_id': user_id}))
    else:
        budgets = [b for b in memory_storage['budgets'] if b['user_id'] == user_id]

    return jsonify({'budgets': serialize_doc(budgets)})

@app.route('/api/budgets', methods=['POST'])
@token_required
@with_connection_retry(max_retries=3)
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

    if db_manager.db is not None:
        result = budgets_collection.insert_one(budget_data)
        budget_id = str(result.inserted_id)
    else:
        budget_id = get_next_id()
        budget_data['_id'] = budget_id
        memory_storage['budgets'].append(budget_data)

    return jsonify({'message': 'Orçamento criado com sucesso', 'id': budget_id}), 201

@app.route('/api/budgets/<budget_id>', methods=['PUT'])
@token_required
@with_connection_retry(max_retries=3)
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

    if db_manager.db is not None:
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
@with_connection_retry(max_retries=3)
def delete_budget(current_user, budget_id):
    user_id = str(current_user['_id'])

    if db_manager.db is not None:
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

# =====================================================
# ENDPOINT DE TRANSFERÊNCIA ENTRE CONTAS
# =====================================================

@app.route('/api/transfer', methods=['POST'])
@token_required
@with_connection_retry(max_retries=3)
def transfer_between_accounts(current_user):
    """
    Endpoint para realizar transferência entre contas.
    A transferência desconta da conta de origem e adiciona na conta de destino.
    """
    data = request.get_json()
    
    required_fields = ['from_account_id', 'to_account_id', 'amount']
    if not data or not all(k in data for k in required_fields):
        return jsonify({'message': 'Dados incompletos. Forneça: from_account_id, to_account_id e amount'}), 400
    
    user_id = str(current_user['_id'])
    from_account_id = data['from_account_id']
    to_account_id = data['to_account_id']
    amount = float(data['amount'])
    description = data.get('description', 'Transferência entre contas')
    
    # Validações
    if amount <= 0:
        return jsonify({'message': 'O valor da transferência deve ser maior que zero'}), 400
    
    if from_account_id == to_account_id:
        return jsonify({'message': 'A conta de origem e destino não podem ser iguais'}), 400
    
    try:
        # Buscar contas de origem e destino
        if db_manager.db is not None:
            from_account = accounts_collection.find_one({
                '_id': ObjectId(from_account_id),
                'user_id': user_id
            })
            to_account = accounts_collection.find_one({
                '_id': ObjectId(to_account_id),
                'user_id': user_id
            })
        else:
            from_account = next((a for a in memory_storage['accounts']
                                if a['_id'] == from_account_id and a['user_id'] == user_id), None)
            to_account = next((a for a in memory_storage['accounts']
                              if a['_id'] == to_account_id and a['user_id'] == user_id), None)
        
        if not from_account:
            return jsonify({'message': 'Conta de origem não encontrada'}), 404
        
        if not to_account:
            return jsonify({'message': 'Conta de destino não encontrada'}), 404
        
        # Verificar se a conta de origem é cartão de crédito
        if from_account.get('type') == 'cartao':
            return jsonify({'message': 'Não é possível transferir de um cartão de crédito. Use o cartão para pagar uma despesa.'}), 400
        
        # Verificar saldo suficiente na conta de origem
        current_balance = from_account.get('balance', 0)
        if current_balance < amount:
            return jsonify({
                'message': f'Saldo insuficiente. Saldo atual: R$ {current_balance:.2f}, Valor da transferência: R$ {amount:.2f}'
            }), 400
        
        # Executar a transferência
        if db_manager.db is not None:
            # Atualizar conta de origem (diminuir saldo)
            accounts_collection.update_one(
                {'_id': ObjectId(from_account_id), 'user_id': user_id},
                {'$set': {
                    'balance': current_balance - amount,
                    'updated_at': datetime.utcnow()
                }}
            )
            
            # Atualizar conta de destino (aumentar saldo)
            to_current_balance = to_account.get('balance', 0)
            accounts_collection.update_one(
                {'_id': ObjectId(to_account_id), 'user_id': user_id},
                {'$set': {
                    'balance': to_current_balance + amount,
                    'updated_at': datetime.utcnow()
                }}
            )
            
            # Registrar a transferência no histórico
            transfer_record = {
                'user_id': user_id,
                'from_account_id': from_account_id,
                'to_account_id': to_account_id,
                'from_account_name': from_account.get('name'),
                'to_account_name': to_account.get('name'),
                'amount': amount,
                'description': description,
                'created_at': datetime.utcnow()
            }
            transfers_collection.insert_one(transfer_record)
            
        else:
            # Memory storage fallback
            from_account['balance'] = current_balance - amount
            from_account['updated_at'] = datetime.utcnow()
            
            to_current_balance = to_account.get('balance', 0)
            to_account['balance'] = to_current_balance + amount
            to_account['updated_at'] = datetime.utcnow()
            
            # Registrar no histórico
            transfer_record = {
                '_id': get_next_id(),
                'user_id': user_id,
                'from_account_id': from_account_id,
                'to_account_id': to_account_id,
                'from_account_name': from_account.get('name'),
                'to_account_name': to_account.get('name'),
                'amount': amount,
                'description': description,
                'created_at': datetime.utcnow()
            }
            memory_storage['transfers'].append(transfer_record)
        
        return jsonify({
            'message': 'Transferência realizada com sucesso!',
            'transfer': {
                'from_account': from_account.get('name'),
                'to_account': to_account.get('name'),
                'amount': amount,
                'description': description
            }
        }), 200
        
    except Exception as e:
        print(f'Erro ao realizar transferência: {e}')
        return jsonify({'message': f'Erro ao realizar transferência: {str(e)}'}), 500


@app.route('/api/transfers', methods=['GET'])
@token_required
@with_connection_retry(max_retries=3)
def get_transfers(current_user):
    """Endpoint para obter histórico de transferências"""
    user_id = str(current_user['_id'])
    
    if db_manager.db is not None:
        transfers = list(transfers_collection.find({'user_id': user_id}).sort('created_at', -1))
    else:
        transfers = [t for t in memory_storage['transfers'] if t['user_id'] == user_id]
        transfers.sort(key=lambda x: x.get('created_at', datetime.min), reverse=True)
    
    return jsonify({'transfers': serialize_doc(transfers)})


# Accounts Routes
@app.route('/api/accounts', methods=['GET'])
@token_required
@with_connection_retry(max_retries=3)
def get_accounts(current_user):
    user_id = str(current_user['_id'])

    if db_manager.db is not None:
        accounts = list(accounts_collection.find({'user_id': user_id}))
    else:
        accounts = [a for a in memory_storage['accounts'] if a['user_id'] == user_id]

    return jsonify({'accounts': serialize_doc(accounts)})

@app.route('/api/accounts', methods=['POST'])
@token_required
@with_connection_retry(max_retries=3)
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

    if data['type'] == 'cartao':
        credit_limit = float(data.get('credit_limit', 0))
        closing_day = int(data.get('closing_day', 1))

        if closing_day < 1 or closing_day > 31:
            return jsonify({'message': 'Dia de fechamento deve ser entre 1 e 31'}), 400

        account_data['credit_limit'] = credit_limit
        account_data['closing_day'] = closing_day
        account_data['balance'] = credit_limit
        account_data['last_reset_date'] = None

    if db_manager.db is not None:
        result = accounts_collection.insert_one(account_data)
        account_id = str(result.inserted_id)
    else:
        account_id = get_next_id()
        account_data['_id'] = account_id
        memory_storage['accounts'].append(account_data)

    return jsonify({'message': 'Conta criada com sucesso', 'id': account_id}), 201

@app.route('/api/accounts/<account_id>', methods=['PUT'])
@token_required
@with_connection_retry(max_retries=3)
def update_account(current_user, account_id):
    data = request.get_json()
    user_id = str(current_user['_id'])

    update_data = {}
    for field in ['name', 'type', 'balance', 'credit_limit', 'closing_day']:
        if field in data:
            if field in ['balance', 'credit_limit']:
                update_data[field] = float(data[field])
            elif field == 'closing_day':
                closing_day = int(data[field])
                if closing_day < 1 or closing_day > 31:
                    return jsonify({'message': 'Dia de fechamento deve ser entre 1 e 31'}), 400
                update_data[field] = closing_day
            else:
                update_data[field] = data[field]

    update_data['updated_at'] = datetime.utcnow()

    if db_manager.db is not None:
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
@with_connection_retry(max_retries=3)
def delete_account(current_user, account_id):
    user_id = str(current_user['_id'])

    if db_manager.db is not None:
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


# =====================================================
# ENDPOINT DE DEBUG PARA CARTÃO DE CRÉDITO
# =====================================================

@app.route('/api/debug/credit-card/<account_id>', methods=['GET'])
@token_required
@with_connection_retry(max_retries=3)
def debug_credit_card(current_user, account_id):
    """Endpoint de debug para diagnosticar problemas no cartão de crédito"""
    user_id = str(current_user['_id'])
    
    try:
        # Buscar o cartão
        if db_manager.db is not None:
            card = accounts_collection.find_one({
                '_id': ObjectId(account_id),
                'user_id': user_id,
                'type': 'cartao'
            })
            
            if not card:
                return jsonify({'message': 'Cartão não encontrado'}), 404
            
            # Buscar todas as transações do cartão
            transactions = list(transactions_collection.find({
                'user_id': user_id,
                'account_id': account_id
            }))
            
            # Calcular o saldo correto
            total_expenses = 0
            total_income = 0
            
            for t in transactions:
                expense = t.get('expense', 0)
                income = t.get('income', 0)
                total_expenses += expense
                total_income += income
            
            credit_limit = card.get('credit_limit', 0)
            current_balance = card.get('balance', 0)
            correct_balance = credit_limit - total_expenses + total_income
            
            return jsonify({
                'debug_info': {
                    'card_name': card.get('name'),
                    'credit_limit': credit_limit,
                    'current_balance_in_db': current_balance,
                    'correct_balance': correct_balance,
                    'difference': current_balance - correct_balance,
                    'total_transactions': len(transactions),
                    'total_expenses': total_expenses,
                    'total_income': total_income,
                    'is_balance_correct': current_balance == correct_balance
                },
                'transactions': serialize_doc(transactions)
            })
        else:
            return jsonify({'message': 'Debug disponível apenas com MongoDB'}), 400
            
    except Exception as e:
        return jsonify({'message': f'Erro: {str(e)}'}), 500


@app.route('/api/debug/credit-card/<account_id>/fix', methods=['POST'])
@token_required
@with_connection_retry(max_retries=3)
def fix_credit_card_balance(current_user, account_id):
    """Endpoint para corrigir o saldo do cartão de crédito"""
    user_id = str(current_user['_id'])
    
    try:
        if db_manager.db is not None:
            card = accounts_collection.find_one({
                '_id': ObjectId(account_id),
                'user_id': user_id,
                'type': 'cartao'
            })
            
            if not card:
                return jsonify({'message': 'Cartão não encontrado'}), 404
            
            # Buscar todas as transações do cartão
            transactions = list(transactions_collection.find({
                'user_id': user_id,
                'account_id': account_id
            }))
            
            # Calcular o saldo correto
            total_expenses = 0
            total_income = 0
            
            for t in transactions:
                expense = t.get('expense', 0)
                income = t.get('income', 0)
                total_expenses += expense
                total_income += income
            
            credit_limit = card.get('credit_limit', 0)
            old_balance = card.get('balance', 0)
            correct_balance = credit_limit - total_expenses + total_income
            
            # Atualizar o saldo
            accounts_collection.update_one(
                {'_id': ObjectId(account_id)},
                {'$set': {
                    'balance': correct_balance,
                    'updated_at': datetime.utcnow()
                }}
            )
            
            return jsonify({
                'message': 'Saldo do cartão corrigido com sucesso!',
                'fix_result': {
                    'card_name': card.get('name'),
                    'credit_limit': credit_limit,
                    'old_balance': old_balance,
                    'new_balance': correct_balance,
                    'total_expenses': total_expenses,
                    'total_income': total_income,
                    'correction_amount': correct_balance - old_balance
                }
            })
        else:
            return jsonify({'message': 'Correção disponível apenas com MongoDB'}), 400
            
    except Exception as e:
        return jsonify({'message': f'Erro: {str(e)}'}), 500


# =====================================================
# ROTAS DE RESET DE CARTÃO DE CRÉDITO
# =====================================================

@app.route('/api/accounts/check-resets', methods=['POST'])
@token_required
@with_connection_retry(max_retries=3)
def check_credit_card_resets(current_user):
    user_id = str(current_user['_id'])

    reset_cards = check_and_reset_credit_cards(user_id)

    return jsonify({
        'message': f'{len(reset_cards)} cartão(ões) resetado(s)' if reset_cards else 'Nenhum cartão para resetar hoje',
        'reset_cards': reset_cards,
        'reset_count': len(reset_cards)
    })

@app.route('/api/accounts/<account_id>/reset', methods=['POST'])
@token_required
@with_connection_retry(max_retries=3)
def manual_reset_credit_card(current_user, account_id):
    user_id = str(current_user['_id'])

    result = force_reset_credit_card(user_id, account_id)

    if result:
        return jsonify({
            'message': f'Cartão "{result["name"]}" resetado com sucesso!',
            'card': result
        })
    else:
        return jsonify({'message': 'Cartão não encontrado ou não é um cartão de crédito'}), 404

@app.route('/api/accounts/credit-cards', methods=['GET'])
@token_required
@with_connection_retry(max_retries=3)
def get_credit_cards(current_user):
    user_id = str(current_user['_id'])

    if db_manager.db is not None:
        credit_cards = list(accounts_collection.find({
            'user_id': user_id,
            'type': 'cartao'
        }))
    else:
        credit_cards = [a for a in memory_storage['accounts']
                       if a['user_id'] == user_id and a['type'] == 'cartao']

    today = datetime.utcnow().day
    cards_with_info = []

    for card in credit_cards:
        card_info = serialize_doc(card)
        closing_day = card.get('closing_day', 1)

        if closing_day >= today:
            days_until_closing = closing_day - today
        else:
            import calendar
            current_month = datetime.utcnow().month
            current_year = datetime.utcnow().year
            days_in_month = calendar.monthrange(current_year, current_month)[1]
            days_until_closing = (days_in_month - today) + closing_day

        card_info['days_until_closing'] = days_until_closing
        card_info['is_closing_today'] = closing_day == today
        card_info['used_limit'] = card.get('credit_limit', 0) - card.get('balance', 0)
        card_info['usage_percentage'] = (
            (card_info['used_limit'] / card.get('credit_limit', 1)) * 100
            if card.get('credit_limit', 0) > 0 else 0
        )

        cards_with_info.append(card_info)

    return jsonify({'credit_cards': cards_with_info})

@app.route('/api/accounts/reset-history', methods=['GET'])
@token_required
@with_connection_retry(max_retries=3)
def get_reset_history(current_user):
    user_id = str(current_user['_id'])

    if db_manager.db is not None:
        history = list(credit_card_resets_collection.find({
            'user_id': user_id
        }).sort('reset_date', -1).limit(50))
    else:
        history = [r for r in memory_storage['credit_card_resets'] if r['user_id'] == user_id]
        history.sort(key=lambda x: x.get('reset_date', datetime.min), reverse=True)
        history = history[:50]

    return jsonify({'history': serialize_doc(history)})


# Goals Routes
@app.route('/api/goals', methods=['GET'])
@token_required
@with_connection_retry(max_retries=3)
def get_goals(current_user):
    user_id = str(current_user['_id'])

    if db_manager.db is not None:
        goals = list(goals_collection.find({'user_id': user_id}))
    else:
        goals = [g for g in memory_storage['goals'] if g['user_id'] == user_id]

    return jsonify({'goals': serialize_doc(goals)})

@app.route('/api/goals', methods=['POST'])
@token_required
@with_connection_retry(max_retries=3)
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

    if db_manager.db is not None:
        result = goals_collection.insert_one(goal_data)
        goal_id = str(result.inserted_id)
    else:
        goal_id = get_next_id()
        goal_data['_id'] = goal_id
        memory_storage['goals'].append(goal_data)

    return jsonify({'message': 'Meta criada com sucesso', 'id': goal_id}), 201

@app.route('/api/goals/<goal_id>', methods=['PUT'])
@token_required
@with_connection_retry(max_retries=3)
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

    if db_manager.db is not None:
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
@with_connection_retry(max_retries=3)
def delete_goal(current_user, goal_id):
    user_id = str(current_user['_id'])

    if db_manager.db is not None:
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
@with_connection_retry(max_retries=3)
def get_stats():
    if db_manager.db is not None:
        total_users = users_collection.count_documents({})
        total_transactions = transactions_collection.count_documents({})
        total_categories = categories_collection.count_documents({})
    else:
        total_users = len(memory_storage['users'])
        total_transactions = len(memory_storage['transactions'])
        total_categories = len(memory_storage['categories'])

    return jsonify({
        'status': 'online',
        'database': 'MongoDB Atlas' if db_manager.db is not None else 'Memory Storage',
        'total_users': total_users,
        'total_transactions': total_transactions,
        'total_categories': total_categories,
        'version': '2.2.0'  # Versão atualizada com reconexão automática
    })

# Export Routes
@app.route('/api/export/<format>', methods=['GET'])
@token_required
@with_connection_retry(max_retries=3)
def export_data(current_user, format):
    user_id = str(current_user['_id'])

    if db_manager.db is not None:
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
@with_connection_retry(max_retries=3)
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

        if db_manager.db is not None:
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

                    if db_manager.db is not None:
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

                if db_manager.db is not None:
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
    try:
        if db_manager.db is not None:
            db_manager.client.admin.command('ping')
            db_status = 'connected'
        else:
            db_status = 'memory'
    except Exception:
        db_status = 'disconnected'

    return jsonify({
        'status': 'healthy',
        'database': db_status,
        'message': 'Servidor ativo',
        'timestamp': datetime.utcnow().isoformat()
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
