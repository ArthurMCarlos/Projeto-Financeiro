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

if MONGODB_URI:
    try:
        client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
        # Test connection
        client.admin.command('ping')
        db = client[DATABASE_NAME]
        users_collection = db.users
        transactions_collection = db.transactions
        categories_collection = db.categories
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
    'categories': []
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
            
            if db:
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
    """Convert MongoDB document to JSON serializable format"""
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
    """Generate next ID for in-memory storage"""
    import uuid
    return str(uuid.uuid4())

# Routes

@app.route('/')
def index():
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
            .info { border-left: 5px solid #60a5fa; }
            .endpoints { display: grid; gap: 10px; margin-top: 20px; }
            .endpoint { 
                background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px;
                display: flex; justify-content: space-between; align-items: center;
            }
            .method { 
                background: #3b82f6; color: white; padding: 4px 12px; 
                border-radius: 20px; font-size: 0.8rem; font-weight: bold;
            }
            .method.post { background: #10b981; }
            .method.put { background: #f59e0b; }
            .method.delete { background: #ef4444; }
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
            .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 30px 0; }
            .stat { text-align: center; background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; }
            .stat-number { font-size: 2rem; font-weight: bold; margin-bottom: 5px; }
            .stat-label { opacity: 0.8; }
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
                <p>Backend Flask rodando com sucesso! Todas as funcionalidades estão disponíveis.</p>
                <div class="stats">
                    <div class="stat">
                        <div class="stat-number">12</div>
                        <div class="stat-label">Endpoints</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">{{ 'MongoDB' if db else 'Memória' }}</div>
                        <div class="stat-label">Banco de Dados</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">JWT</div>
                        <div class="stat-label">Autenticação</div>
                    </div>
                </div>
            </div>
            
            <div class="status info">
                <h3>🔗 Acesso Rápido</h3>
                <div style="text-align: center;">
                    <a href="/login.html" class="btn">🔐 Acessar Sistema</a>
                    <a href="/api/stats" class="btn">📊 Ver Estatísticas</a>
                </div>
            </div>
            
            <div class="status info">
                <h3>📋 Endpoints da API</h3>
                <div class="endpoints">
                    <div class="endpoint">
                        <span><strong>Cadastrar usuário</strong></span>
                        <span class="method post">POST /api/auth/register</span>
                    </div>
                    <div class="endpoint">
                        <span><strong>Fazer login</strong></span>
                        <span class="method post">POST /api/auth/login</span>
                    </div>
                    <div class="endpoint">
                        <span><strong>Listar transações</strong></span>
                        <span class="method">GET /api/transactions</span>
                    </div>
                    <div class="endpoint">
                        <span><strong>Criar transação</strong></span>
                        <span class="method post">POST /api/transactions</span>
                    </div>
                    <div class="endpoint">
                        <span><strong>Atualizar transação</strong></span>
                        <span class="method put">PUT /api/transactions/&lt;id&gt;</span>
                    </div>
                    <div class="endpoint">
                        <span><strong>Excluir transação</strong></span>
                        <span class="method delete">DELETE /api/transactions/&lt;id&gt;</span>
                    </div>
                    <div class="endpoint">
                        <span><strong>Listar categorias</strong></span>
                        <span class="method">GET /api/categories</span>
                    </div>
                    <div class="endpoint">
                        <span><strong>Criar categoria</strong></span>
                        <span class="method post">POST /api/categories</span>
                    </div>
                    <div class="endpoint">
                        <span><strong>Excluir categoria</strong></span>
                        <span class="method delete">DELETE /api/categories/&lt;id&gt;</span>
                    </div>
                    <div class="endpoint">
                        <span><strong>Estatísticas</strong></span>
                        <span class="method">GET /api/stats</span>
                    </div>
                    <div class="endpoint">
                        <span><strong>Exportar dados</strong></span>
                        <span class="method">GET /api/export/&lt;format&gt;</span>
                    </div>
                    <div class="endpoint">
                        <span><strong>Importar dados</strong></span>
                        <span class="method post">POST /api/import</span>
                    </div>
                </div>
            </div>
            
            <div style="text-align: center; margin-top: 40px; opacity: 0.8;">
                <p>🚀 Deploy realizado com sucesso no Render.com</p>
                <p>💾 Dados {{ 'persistidos no MongoDB Atlas' if db else 'em memória (desenvolvimento)' }}</p>
            </div>
        </div>
    </body>
    </html>
    """, db=db)

# Authentication Routes
@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or not all(k in data for k in ('name', 'email', 'password')):
        return jsonify({'message': 'Dados incompletos'}), 400
    
    # Check if user already exists
    if db:
        existing_user = users_collection.find_one({'email': data['email']})
    else:
        existing_user = next((u for u in memory_storage['users'] if u['email'] == data['email']), None)
    
    if existing_user:
        return jsonify({'message': 'Email já cadastrado'}), 409
    
    # Create new user
    user_data = {
        'name': data['name'],
        'email': data['email'],
        'password': generate_password_hash(data['password']),
        'created_at': datetime.utcnow()
    }
    
    if db:
        result = users_collection.insert_one(user_data)
        user_id = str(result.inserted_id)
    else:
        user_id = get_next_id()
        user_data['_id'] = user_id
        memory_storage['users'].append(user_data)
    
    # Create default categories for new user
    default_categories = [
        'Alimentação', 'Transporte', 'Moradia', 'Saúde', 
        'Educação', 'Lazer', 'Roupas', 'Outros'
    ]
    
    for category_name in default_categories:
        category_data = {
            'name': category_name,
            'user_id': user_id,
            'created_at': datetime.utcnow()
        }
        
        if db:
            categories_collection.insert_one(category_data)
        else:
            category_data['_id'] = get_next_id()
            memory_storage['categories'].append(category_data)
    
    return jsonify({'message': 'Usuário cadastrado com sucesso'}), 201

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or not all(k in data for k in ('email', 'password')):
        return jsonify({'message': 'Email e senha são obrigatórios'}), 400
    
    # Find user
    if db:
        user = users_collection.find_one({'email': data['email']})
    else:
        user = next((u for u in memory_storage['users'] if u['email'] == data['email']), None)
    
    if not user or not check_password_hash(user['password'], data['password']):
        return jsonify({'message': 'Email ou senha inválidos'}), 401
    
    # Generate token
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
    
    if db:
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
    
    category_data = {
        'name': data['name'],
        'user_id': user_id,
        'created_at': datetime.utcnow()
    }
    
    if db:
        result = categories_collection.insert_one(category_data)
        category_id = str(result.inserted_id)
    else:
        category_id = get_next_id()
        category_data['_id'] = category_id
        memory_storage['categories'].append(category_data)
    
    return jsonify({'message': 'Categoria criada com sucesso', 'id': category_id}), 201

@app.route('/api/categories/<category_id>', methods=['DELETE'])
@token_required
def delete_category(current_user, category_id):
    user_id = str(current_user['_id'])
    
    if db:
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
    
    if db:
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
        'user_id': user_id,
        'created_at': datetime.utcnow()
    }
    
    if db:
        result = transactions_collection.insert_one(transaction_data)
        transaction_id = str(result.inserted_id)
    else:
        transaction_id = get_next_id()
        transaction_data['_id'] = transaction_id
        memory_storage['transactions'].append(transaction_data)
    
    return jsonify({'message': 'Transação criada com sucesso', 'id': transaction_id}), 201

@app.route('/api/transactions/<transaction_id>', methods=['PUT'])
@token_required
def update_transaction(current_user, transaction_id):
    data = request.get_json()
    user_id = str(current_user['_id'])
    
    update_data = {}
    for field in ['month', 'reason', 'expense', 'current_value', 'category_id', 'income']:
        if field in data:
            if field in ['expense', 'current_value', 'income']:
                update_data[field] = float(data[field])
            else:
                update_data[field] = data[field]
    
    update_data['updated_at'] = datetime.utcnow()
    
    if db:
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
    
    return jsonify({'message': 'Transação atualizada com sucesso'})

@app.route('/api/transactions/<transaction_id>', methods=['DELETE'])
@token_required
def delete_transaction(current_user, transaction_id):
    user_id = str(current_user['_id'])
    
    if db:
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
    
    return jsonify({'message': 'Transação excluída com sucesso'})

# Statistics Route
@app.route('/api/stats', methods=['GET'])
@token_required
def get_stats(current_user):
    user_id = str(current_user['_id'])
    
    if db:
        transactions = list(transactions_collection.find({'user_id': user_id}))
    else:
        transactions = [t for t in memory_storage['transactions'] if t['user_id'] == user_id]
    
    total_income = sum(t.get('income', 0) for t in transactions)
    total_expense = sum(t.get('expense', 0) for t in transactions)
    balance = total_income - total_expense
    
    # Monthly average
    monthly_expenses = {}
    for t in transactions:
        month = t.get('month')
        if month:
            if month not in monthly_expenses:
                monthly_expenses[month] = 0
            monthly_expenses[month] += t.get('expense', 0)
    
    avg_expense = sum(monthly_expenses.values()) / len(monthly_expenses) if monthly_expenses else 0
    
    return jsonify({
        'total_income': total_income,
        'total_expense': total_expense,
        'balance': balance,
        'avg_monthly_expense': avg_expense,
        'total_transactions': len(transactions)
    })

# Export Routes
@app.route('/api/export/<format>', methods=['GET'])
@token_required
def export_data(current_user, format):
    user_id = str(current_user['_id'])
    
    if db:
        transactions = list(transactions_collection.find({'user_id': user_id}))
        categories = list(categories_collection.find({'user_id': user_id}))
    else:
        transactions = [t for t in memory_storage['transactions'] if t['user_id'] == user_id]
        categories = [c for c in memory_storage['categories'] if c['user_id'] == user_id]
    
    # Create category lookup
    category_lookup = {c['_id']: c['name'] for c in categories}
    
    # Prepare data
    export_data = []
    for t in transactions:
        export_data.append({
            'Mês': t.get('month', ''),
            'Motivo': t.get('reason', ''),
            'Valor Gasto (R$)': t.get('expense', 0),
            'Valor Atual (R$)': t.get('current_value', 0),
            'Categoria': category_lookup.get(t.get('category_id'), 'Sem categoria'),
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
    
    elif format == 'pdf':
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4)
        
        # Styles
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=16,
            spaceAfter=30,
            alignment=1  # Center
        )
        
        # Content
        content = []
        
        # Title
        title = Paragraph("Relatório Financeiro", title_style)
        content.append(title)
        content.append(Spacer(1, 12))
        
        # Table data
        table_data = [['Mês', 'Motivo', 'Gasto (R$)', 'Atual (R$)', 'Categoria', 'Receita (R$)']]
        
        for item in export_data:
            table_data.append([
                item['Mês'],
                item['Motivo'][:30] + '...' if len(item['Motivo']) > 30 else item['Motivo'],
                f"R$ {item['Valor Gasto (R$)']:.2f}",
                f"R$ {item['Valor Atual (R$)']:.2f}",
                item['Categoria'],
                f"R$ {item['Valor Recebido (R$)']:.2f}"
            ])
        
        # Create table
        table = Table(table_data)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 1, colors.black)
        ]))
        
        content.append(table)
        
        # Build PDF
        doc.build(content)
        buffer.seek(0)
        
        return send_file(
            buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=f'financeiro_{datetime.now().strftime("%Y%m%d")}.pdf'
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
        # Read file
        if file.filename.endswith('.csv'):
            df = pd.read_csv(file)
        elif file.filename.endswith('.xlsx'):
            df = pd.read_excel(file)
        else:
            return jsonify({'message': 'Formato de arquivo não suportado'}), 400
        
        # Get user categories
        if db:
            categories = list(categories_collection.find({'user_id': user_id}))
        else:
            categories = [c for c in memory_storage['categories'] if c['user_id'] == user_id]
        
        category_lookup = {c['name']: str(c['_id']) for c in categories}
        
        imported_count = 0
        
        for _, row in df.iterrows():
            try:
                # Map category
                category_name = row.get('Categoria', '')
                category_id = category_lookup.get(category_name)
                
                if not category_id:
                    # Create new category
                    category_data = {
                        'name': category_name,
                        'user_id': user_id,
                        'created_at': datetime.utcnow()
                    }
                    
                    if db:
                        result = categories_collection.insert_one(category_data)
                        category_id = str(result.inserted_id)
                    else:
                        category_id = get_next_id()
                        category_data['_id'] = category_id
                        memory_storage['categories'].append(category_data)
                    
                    category_lookup[category_name] = category_id
                
                # Create transaction
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
                
                if db:
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
    # Serve static files from current directory
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
        'database': 'mongodb' if db else 'memory',
        'timestamp': datetime.utcnow().isoformat()
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)