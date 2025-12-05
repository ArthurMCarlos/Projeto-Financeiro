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
import calendar
import atexit

app = Flask(__name__)
# Configuration
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
CORS(app, origins=["*"])

# MongoDB Configuration
MONGODB_URI = os.environ.get('MONGODB_URI')
DATABASE_NAME = os.environ.get('DATABASE_NAME', 'financial_organizer')

# Global variables for MongoDB connection
client = None
db = None
users_collection = None
transactions_collection = None
categories_collection = None
incomes_collection = None
budgets_collection = None
accounts_collection = None
goals_collection = None

# Connect to MongoDB
def connect_to_mongodb():
    global client, db, users_collection, transactions_collection, categories_collection, incomes_collection, budgets_collection, accounts_collection, goals_collection
    
    if MONGODB_URI:
        try:
            print("🔄 Tentando conectar ao MongoDB...")
            client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
            # Test the connection
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
            return True
        except Exception as e:
            print(f"❌ Erro ao conectar ao MongoDB: {e}")
            print("⚠️ Usando armazenamento em memória")
            return False
    else:
        print("⚠️ MONGODB_URI não configurado, usando armazenamento em memória")
        return False

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

# Connect to MongoDB at startup
mongodb_connected = connect_to_mongodb()

# APScheduler Setup
try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    
    scheduler = BackgroundScheduler()
    
    def check_and_reset_credit_cards():
        """Função que verifica e executa resets automáticos de cartões"""
        try:
            print("🔄 Verificando resets automáticos de cartões...")
            
            # Get all credit cards with auto-reset enabled
            if mongodb_connected and accounts_collection:
                credit_cards = list(accounts_collection.find({
                    'type': 'cartao',
                    'reset_enabled': True
                }))
            else:
                # Memory storage
                credit_cards = [acc for acc in memory_storage['accounts'] 
                              if acc.get('type') == 'cartao' and acc.get('reset_enabled')]
            
            today = datetime.now().date()
            
            for card in credit_cards:
                try:
                    next_reset_str = card.get('next_reset_date')
                    if next_reset_str:
                        if isinstance(next_reset_str, str):
                            next_reset_date = datetime.fromisoformat(next_reset_str).date()
                        else:
                            next_reset_date = next_reset_str.date()
                        
                        if today >= next_reset_date:
                            print(f"🔄 Executando reset automático para cartão: {card.get('name')}")
                            
                            # Calculate new next reset date
                            billing_day = card.get('billing_cycle_day', 1)
                            current_date = datetime.now()
                            next_date = calculate_next_billing_date(current_date, billing_day)
                            
                            # Update card
                            if mongodb_connected and accounts_collection:
                                accounts_collection.update_one(
                                    {'_id': card['_id']},
                                    {
                                        '$set': {
                                            'balance': card.get('credit_limit', 0),
                                            'next_reset_date': next_date,
                                            'updated_at': datetime.utcnow()
                                        },
                                        '$push': {
                                            'reset_history': {
                                                'date': datetime.utcnow(),
                                                'reason': 'Reset automático',
                                                'previous_balance': card.get('balance', 0),
                                                'new_balance': card.get('credit_limit', 0)
                                            }
                                        }
                                    }
                                )
                            else:
                                # Update in memory
                                card['balance'] = card.get('credit_limit', 0)
                                card['next_reset_date'] = next_date
                                
                                if 'reset_history' not in card:
                                    card['reset_history'] = []
                                card['reset_history'].append({
                                    'date': datetime.utcnow(),
                                    'reason': 'Reset automático',
                                    'previous_balance': card.get('balance', 0),
                                    'new_balance': card.get('credit_limit', 0)
                                })
                                
                                # Update in memory storage
                                for i, acc in enumerate(memory_storage['accounts']):
                                    if acc['_id'] == card['_id']:
                                        memory_storage['accounts'][i] = card
                                        break
                
                except Exception as e:
                    print(f"❌ Erro ao processar cartão {card.get('name', 'Unknown')}: {e}")
                    continue
            
            print("✅ Verificação de resets automáticos concluída")
            
        except Exception as e:
            print(f"❌ Erro geral na verificação de resets: {e}")
    
    def setup_scheduler():
        """Configurar agendador de resets automáticos"""
        try:
            # Add job to run daily at 01:00
            scheduler.add_job(
                check_and_reset_credit_cards,
                'cron',
                hour=1,
                minute=0,
                timezone='America/Sao_Paulo',
                id='check_credit_card_resets'
            )
            
            scheduler.start()
            
            # Agendar shutdown
            atexit.register(lambda: scheduler.shutdown())
            
            print("✅ Agendador de resets automáticos configurado (execução diária às 01:00)")
            
        except ImportError:
            print("⚠️ APScheduler não disponível. Resets automáticos não serão agendados.")
            print("   Para ativar, instale: pip install APScheduler==3.10.4")
        except Exception as e:
            print(f"❌ Erro ao configurar agendador: {e}")

except ImportError:
    print("⚠️ APScheduler não está disponível. Instale com: pip install APScheduler==3.10.4")
    scheduler = None

# Utility Functions
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'message': 'Token ausente!'}), 401
        
        try:
            if token.startswith('Bearer '):
                token = token[7:]
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            current_user = get_user_by_id(data['user_id'])
            if not current_user:
                return jsonify({'message': 'Token inválido!'}), 401
            return f(current_user, *args, **kwargs)
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token expirado!'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Token inválido!'}), 401
    
    return decorated

def get_user_by_id(user_id):
    """Buscar usuário por ID"""
    if mongodb_connected and users_collection:
        return users_collection.find_one({'_id': ObjectId(user_id)})
    else:
        return next((user for user in memory_storage['users'] if str(user.get('_id')) == str(user_id)), None)

def get_current_user_id():
    """Obter ID do usuário atual do token"""
    token = request.headers.get('Authorization')
    if not token:
        return None
    
    try:
        if token.startswith('Bearer '):
            token = token[7:]
        data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
        return data['user_id']
    except:
        return None

def calculate_next_billing_date(current_date, billing_cycle_day):
    """
    Calcula a próxima data de fechamento da fatura
    
    Args:
        current_date (datetime): Data atual
        billing_cycle_day (int): Dia do fechamento da fatura (1-31)
    
    Returns:
        datetime: Próxima data de fechamento
    """
    try:
        # Ajustar dia se for maior que os dias do mês
        last_day = calendar.monthrange(current_date.year, current_date.month)[1]
        adjusted_day = min(billing_cycle_day, last_day)
        
        # Próxima data de fechamento deste mês
        if current_date.day <= adjusted_day:
            next_date = current_date.replace(day=adjusted_day)
        else:
            # Próximo mês
            if current_date.month == 12:
                next_date = current_date.replace(year=current_date.year + 1, month=1, day=1)
            else:
                next_date = current_date.replace(month=current_date.month + 1, day=1)
            
            # Ajustar dia se necessário
            last_day_next = calendar.monthrange(next_date.year, next_date.month)[1]
            adjusted_day = min(billing_cycle_day, last_day_next)
            next_date = next_date.replace(day=adjusted_day)
        
        return next_date
    except Exception as e:
        print(f"❌ Erro ao calcular próxima data de billing: {e}")
        # Fallback: próximo mês, dia 1
        if current_date.month == 12:
            return current_date.replace(year=current_date.year + 1, month=1, day=1)
        else:
            return current_date.replace(month=current_date.month + 1, day=1)

# Credit Card Reset Routes
@app.route('/api/credit-cards/<account_id>/reset-config', methods=['POST'])
@token_required
def configure_credit_card_reset(current_user, account_id):
    """Configurar reset automático de cartão de crédito"""
    try:
        data = request.get_json()
        user_id = str(current_user['_id'])
        
        # Campos obrigatórios para reset automático
        required_fields = ['credit_limit', 'billing_cycle_day', 'reset_enabled']
        if not data or not all(k in data for k in required_fields):
            return jsonify({'message': 'Dados incompletos para configuração do reset'}), 400
        
        try:
            # Validar dia do fechamento (1-31)
            billing_day = int(data['billing_cycle_day'])
            if billing_day < 1 or billing_day > 31:
                return jsonify({'message': 'Dia de fechamento deve estar entre 1 e 31'}), 400
            
            # Validar limite do cartão
            credit_limit = float(data['credit_limit'])
            if credit_limit <= 0:
                return jsonify({'message': 'Limite do cartão deve ser maior que zero'}), 400
            
            # Calcular próxima data de reset
            current_date = datetime.utcnow()
            next_reset_date = calculate_next_billing_date(current_date, billing_day)
            
            update_data = {
                'credit_limit': credit_limit,
                'billing_cycle_day': billing_day,
                'reset_enabled': bool(data['reset_enabled']),
                'next_reset_date': next_reset_date,
                'updated_at': datetime.utcnow()
            }
            
            # Para memória local, verificar se conta existe
            if mongodb_connected and accounts_collection:
                # Verificar se a conta existe e é do usuário
                account = accounts_collection.find_one({
                    '_id': ObjectId(account_id), 
                    'user_id': user_id
                })
                
                if not account:
                    return jsonify({'message': 'Conta não encontrada'}), 404
                
                if account.get('type') != 'cartao':
                    return jsonify({'message': 'Somente cartões de crédito podem ter reset automático'}), 400
                
                # Atualizar conta no MongoDB
                accounts_collection.update_one(
                    {'_id': ObjectId(account_id)},
                    {'$set': update_data}
                )
                
            else:
                # Usando armazenamento em memória
                account = None
                for acc in memory_storage['accounts']:
                    if str(acc.get('_id')) == str(account_id) and acc.get('user_id') == user_id:
                        account = acc
                        break
                
                if not account:
                    return jsonify({'message': 'Conta não encontrada'}), 404
                
                if account.get('type') != 'cartao':
                    return jsonify({'message': 'Somente cartões de crédito podem ter reset automático'}), 400
                
                # Atualizar na memória
                for acc in memory_storage['accounts']:
                    if str(acc.get('_id')) == str(account_id):
                        acc.update(update_data)
                        break
            
            return jsonify({
                'message': 'Configuração do reset salva com sucesso!',
                'next_reset_date': next_reset_date.strftime('%Y-%m-%d'),
                'credit_limit': credit_limit,
                'billing_cycle_day': billing_day,
                'reset_enabled': bool(data['reset_enabled'])
            })
            
        except (ValueError, TypeError) as e:
            return jsonify({'message': f'Dados inválidos: {str(e)}'}), 400
            
    except Exception as e:
        print(f"❌ Erro ao configurar reset do cartão: {e}")
        return jsonify({'message': 'Erro interno do servidor'}), 500

@app.route('/api/credit-cards/<account_id>/manual-reset', methods=['POST'])
@token_required
def manual_reset_credit_card(current_user, account_id):
    """Executar reset manual de cartão de crédito"""
    try:
        user_id = str(current_user['_id'])
        
        # Verificar se a conta existe e é do usuário
        if mongodb_connected and accounts_collection:
            account = accounts_collection.find_one({
                '_id': ObjectId(account_id), 
                'user_id': user_id
            })
            
            if not account:
                return jsonify({'message': 'Conta não encontrada'}), 404
            
            if account.get('type') != 'cartao':
                return jsonify({'message': 'Somente cartões de crédito podem ser resetados'}), 400
            
            credit_limit = account.get('credit_limit', 0)
            previous_balance = account.get('balance', 0)
            
            # Executar reset
            accounts_collection.update_one(
                {'_id': ObjectId(account_id)},
                {
                    '$set': {
                        'balance': credit_limit,
                        'last_reset_date': datetime.utcnow(),
                        'updated_at': datetime.utcnow()
                    },
                    '$push': {
                        'reset_history': {
                            'date': datetime.utcnow(),
                            'reason': 'Reset manual',
                            'previous_balance': previous_balance,
                            'new_balance': credit_limit
                        }
                    }
                }
            )
            
        else:
            # Usando armazenamento em memória
            account = None
            for acc in memory_storage['accounts']:
                if str(acc.get('_id')) == str(account_id) and acc.get('user_id') == user_id:
                    account = acc
                    break
            
            if not account:
                return jsonify({'message': 'Conta não encontrada'}), 404
            
            if account.get('type') != 'cartao':
                return jsonify({'message': 'Somente cartões de crédito podem ser resetados'}), 400
            
            credit_limit = account.get('credit_limit', 0)
            previous_balance = account.get('balance', 0)
            
            # Atualizar na memória
            account['balance'] = credit_limit
            account['last_reset_date'] = datetime.utcnow()
            account['updated_at'] = datetime.utcnow()
            
            if 'reset_history' not in account:
                account['reset_history'] = []
            
            account['reset_history'].append({
                'date': datetime.utcnow(),
                'reason': 'Reset manual',
                'previous_balance': previous_balance,
                'new_balance': credit_limit
            })
        
        return jsonify({
            'message': 'Reset manual executado com sucesso!',
            'previous_balance': previous_balance,
            'new_balance': credit_limit
        })
        
    except Exception as e:
        print(f"❌ Erro ao fazer reset manual: {e}")
        return jsonify({'message': 'Erro interno do servidor'}), 500

@app.route('/api/credit-cards/<account_id>/reset-history', methods=['GET'])
@token_required
def get_reset_history(current_user, account_id):
    """Obter histórico de resets de um cartão"""
    try:
        user_id = str(current_user['_id'])
        
        if mongodb_connected and accounts_collection:
            account = accounts_collection.find_one({
                '_id': ObjectId(account_id), 
                'user_id': user_id
            })
            
            if not account:
                return jsonify({'message': 'Conta não encontrada'}), 404
            
            reset_history = account.get('reset_history', [])
            
        else:
            # Usando armazenamento em memória
            account = None
            for acc in memory_storage['accounts']:
                if str(acc.get('_id')) == str(account_id) and acc.get('user_id') == user_id:
                    account = acc
                    break
            
            if not account:
                return jsonify({'message': 'Conta não encontrada'}), 404
            
            reset_history = account.get('reset_history', [])
        
        # Formatar histórico para resposta
        formatted_history = []
        for reset in reset_history:
            formatted_history.append({
                'date': reset['date'].strftime('%Y-%m-%d %H:%M:%S') if hasattr(reset['date'], 'strftime') else str(reset['date']),
                'reason': reset['reason'],
                'previous_balance': reset['previous_balance'],
                'new_balance': reset['new_balance']
            })
        
        return jsonify({
            'reset_history': formatted_history,
            'total_resets': len(formatted_history)
        })
        
    except Exception as e:
        print(f"❌ Erro ao buscar histórico de resets: {e}")
        return jsonify({'message': 'Erro interno do servidor'}), 500

@app.route('/api/credit-cards/status-check', methods=['GET'])
def check_credit_card_status():
    """Verificar status do sistema de reset de cartões"""
    try:
        status_info = {
            'status': 'ok',
            'message': 'Credit card reset system is running',
            'mongodb_connected': mongodb_connected,
            'scheduler_active': scheduler is not None and scheduler.running if scheduler else False,
            'timestamp': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        }
        
        return jsonify(status_info)
        
    except Exception as e:
        print(f"❌ Erro ao verificar status: {e}")
        return jsonify({
            'status': 'error',
            'message': f'System error: {str(e)}',
            'timestamp': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        }), 500

@app.route('/api/admin/trigger-automatic-resets', methods=['POST'])
@token_required
def trigger_automatic_resets(current_user):
    """Trigger manual para executar todos os resets automáticos (debug/admin)"""
    try:
        # Verificar se o usuário é admin (opcional)
        if current_user.get('role') != 'admin':
            return jsonify({'message': 'Acesso negado. Apenas administradores.'}), 403
        
        if scheduler and scheduler.running:
            # Forçar execução imediata do job
            scheduler.trigger_job('check_credit_card_resets')
            return jsonify({'message': 'Resets automáticos executados manualmente!'})
        else:
            return jsonify({'message': 'Scheduler não está ativo'}), 400
            
    except Exception as e:
        print(f"❌ Erro ao executar resets manuais: {e}")
        return jsonify({'message': 'Erro interno do servidor'}), 500

# Health Check
@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
        'mongodb_connected': mongodb_connected,
        'scheduler_active': scheduler is not None and scheduler.running if scheduler else False
    })

# User Routes
@app.route('/api/login', methods=['POST'])
def login():
    """Login de usuário"""
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({'message': 'Email e senha são obrigatórios'}), 400
    
    try:
        if mongodb_connected and users_collection:
            user = users_collection.find_one({'email': email})
        else:
            user = next((user for user in memory_storage['users'] if user.get('email') == email), None)
        
        if not user or not check_password_hash(user.get('password'), password):
            return jsonify({'message': 'Credenciais inválidas'}), 401
        
        token = jwt.encode({
            'user_id': str(user['_id']),
            'email': user['email'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm="HS256")
        
        return jsonify({
            'token': token,
            'user': {
                'id': str(user['_id']),
                'name': user.get('name'),
                'email': user.get('email')
            }
        })
    except Exception as e:
        print(f"❌ Erro no login: {e}")
        return jsonify({'message': 'Erro interno do servidor'}), 500

# Account Routes
@app.route('/api/accounts', methods=['GET'])
@token_required
def get_accounts(current_user):
    """Obter contas do usuário"""
    try:
        user_id = str(current_user['_id'])
        
        if mongodb_connected and accounts_collection:
            accounts = list(accounts_collection.find({'user_id': user_id}))
            # Converter ObjectId para string para serialização JSON
            for account in accounts:
                account['_id'] = str(account['_id'])
        else:
            accounts = [acc for acc in memory_storage['accounts'] if acc.get('user_id') == user_id]
        
        return jsonify(accounts)
    except Exception as e:
        print(f"❌ Erro ao buscar contas: {e}")
        return jsonify({'message': 'Erro interno do servidor'}), 500

# Run the app
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    
    # Configurar agendador se estiver usando APScheduler
    if 'scheduler' in globals():
        setup_scheduler()
    
    app.run(host='0.0.0.0', port=port, debug=False)
