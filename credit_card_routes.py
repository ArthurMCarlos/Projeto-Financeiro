# credit_card_routes.py
"""
Rotinas da API para gerenciamento de cartões de crédito e reset automático
"""

from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime, timezone
import pytz

# Importar funções do gerenciador de cartões
try:
    from credit_card_manager import (
        credit_card_manager,
        configure_credit_card,
        get_credit_card_reset_history,
        get_credit_cards_with_resets_due
    )
except ImportError:
    # Fallback para desenvolvimento
    print("⚠️ Usando CreditCardManager standalone")
    import os
    from pymongo import MongoClient
    MONGODB_URI = os.environ.get('MONGODB_URI', 'mongodb://localhost:27017/')
    client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
    db = client['financial_organizer']
    accounts_collection = db.accounts
    transactions_collection = db.transactions

# Blueprint para rotas de cartões de crédito
credit_card_bp = Blueprint('credit_card', __name__, url_prefix='/api/credit-card')

@credit_card_bp.route('/', methods=['GET'])
def get_credit_cards():
    """Lista todos os cartões de crédito do usuário"""
    try:
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'message': 'Token não fornecido'}), 401
        
        # Extrai user_id do token (simplificado)
        user_id = request.args.get('user_id') or 'temp_user'
        
        # Busca cartões de crédito
        credit_cards = list(accounts_collection.find({
            'type': 'cartao',
            'user_id': user_id
        }))
        
        # Serializa os documentos
        serialized_cards = []
        for card in credit_cards:
            card_dict = {
                'id': str(card['_id']),
                'name': card.get('name', ''),
                'type': card.get('type', ''),
                'balance': card.get('balance', 0),
                'credit_limit': card.get('credit_limit', 0),
                'auto_reset': card.get('auto_reset', False),
                'bill_closing_day': card.get('bill_closing_day'),
                'auto_reset_day': card.get('auto_reset_day'),
                'last_reset_date': card.get('last_reset_date'),
                'created_at': card.get('created_at'),
                'updated_at': card.get('updated_at')
            }
            serialized_cards.append(card_dict)
        
        return jsonify({'credit_cards': serialized_cards})
    
    except Exception as e:
        return jsonify({'message': f'Erro ao buscar cartões de crédito: {str(e)}'}), 500

@credit_card_bp.route('/<card_id>', methods=['GET'])
def get_credit_card(card_id):
    """Obtém detalhes de um cartão de crédito específico"""
    try:
        user_id = request.args.get('user_id') or 'temp_user'
        
        card = accounts_collection.find_one({
            '_id': ObjectId(card_id),
            'type': 'cartao',
            'user_id': user_id
        })
        
        if not card:
            return jsonify({'message': 'Cartão de crédito não encontrado'}), 404
        
        # Obtém histórico de resets
        reset_history = get_credit_card_reset_history(card_id, 10)
        
        card_dict = {
            'id': str(card['_id']),
            'name': card.get('name', ''),
            'type': card.get('type', ''),
            'balance': card.get('balance', 0),
            'credit_limit': card.get('credit_limit', 0),
            'auto_reset': card.get('auto_reset', False),
            'bill_closing_day': card.get('bill_closing_day'),
            'auto_reset_day': card.get('auto_reset_day'),
            'last_reset_date': card.get('last_reset_date'),
            'last_reset_amount': card.get('last_reset_amount', 0),
            'reset_history': reset_history,
            'created_at': card.get('created_at'),
            'updated_at': card.get('updated_at')
        }
        
        return jsonify({'credit_card': card_dict})
    
    except Exception as e:
        return jsonify({'message': f'Erro ao buscar cartão de crédito: {str(e)}'}), 500

@credit_card_bp.route('/<card_id>/configure', methods=['PUT'])
def configure_credit_card_api(card_id):
    """Configura as opções de reset automático de um cartão de crédito"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Nenhum dado fornecido'}), 400
        
        user_id = request.args.get('user_id') or 'temp_user'
        
        # Verifica se o cartão existe
        card = accounts_collection.find_one({
            '_id': ObjectId(card_id),
            'type': 'cartao',
            'user_id': user_id
        })
        
        if not card:
            return jsonify({'message': 'Cartão de crédito não encontrado'}), 404
        
        # Campos a serem atualizados
        update_fields = {}
        
        # Limite de crédito
        if 'credit_limit' in data:
            credit_limit = float(data['credit_limit'])
            if credit_limit < 0:
                return jsonify({'message': 'Limite de crédito deve ser positivo'}), 400
            update_fields['credit_limit'] = credit_limit
        
        # Dia de fechamento da fatura
        if 'bill_closing_day' in data:
            closing_day = int(data['bill_closing_day'])
            if not 1 <= closing_day <= 31:
                return jsonify({'message': 'Dia de fechamento deve estar entre 1 e 31'}), 400
            update_fields['bill_closing_day'] = closing_day
        
        # Habilitar/desabilitar reset automático
        if 'auto_reset' in data:
            auto_reset = bool(data['auto_reset'])
            update_fields['auto_reset'] = auto_reset
        
        # Dia para executar o reset automático
        if 'auto_reset_day' in data:
            reset_day = int(data['auto_reset_day'])
            if not 1 <= reset_day <= 31:
                return jsonify({'message': 'Dia de reset deve estar entre 1 e 31'}), 400
            update_fields['auto_reset_day'] = reset_day
        
        # Se auto_reset está habilitado mas reset_day não foi especificado, define igual ao closing_day
        if update_fields.get('auto_reset', card.get('auto_reset', False)) and 'reset_day' not in data:
            update_fields['auto_reset_day'] = update_fields.get('bill_closing_day', card.get('bill_closing_day'))
        
        update_fields['updated_at'] = datetime.now(timezone.utc)
        
        # Atualiza o cartão
        result = accounts_collection.update_one(
            {'_id': ObjectId(card_id), 'user_id': user_id},
            {'$set': update_fields}
        )
        
        if result.matched_count == 0:
            return jsonify({'message': 'Cartão não encontrado ou sem permissão'}), 404
        
        # Log da configuração
        print(f"✅ Cartão {card_id} configurado: {update_fields}")
        
        return jsonify({
            'message': 'Configuração do cartão atualizada com sucesso',
            'updates': update_fields
        })
    
    except Exception as e:
        return jsonify({'message': f'Erro ao configurar cartão: {str(e)}'}), 500

@credit_card_bp.route('/<card_id>/manual-reset', methods=['POST'])
def manual_reset_credit_card(card_id):
    """Executa um reset manual de um cartão de crédito"""
    try:
        user_id = request.args.get('user_id') or 'temp_user'
        
        card = accounts_collection.find_one({
            '_id': ObjectId(card_id),
            'type': 'cartao',
            'user_id': user_id
        })
        
        if not card:
            return jsonify({'message': 'Cartão de crédito não encontrado'}), 404
        
        credit_limit = card.get('credit_limit', 0)
        current_balance = card.get('balance', 0)
        
        # Executa o reset usando o gerenciador
        card['_id'] = ObjectId(card_id)  # Reconverte para ObjectId
        
        # Manualmente executa o reset
        reset_amount = -current_balance
        new_balance = credit_limit
        
        accounts_collection.update_one(
            {'_id': ObjectId(card_id), 'user_id': user_id},
            {
                '$set': {
                    'balance': new_balance,
                    'last_manual_reset_date': datetime.now(timezone.utc),
                    'last_reset_amount': reset_amount,
                    'updated_at': datetime.now(timezone.utc)
                },
                '$push': {
                    'reset_history': {
                        'date': datetime.now(timezone.utc),
                        'reset_amount': reset_amount,
                        'new_balance': new_balance,
                        'credit_limit': credit_limit,
                        'reset_type': 'manual'
                    }
                }
            }
        )
        
        # Cria transação de registro
        brazil_tz = pytz.timezone('America/Sao_Paulo')
        transaction_data = {
            'month': datetime.now(brazil_tz).strftime('%Y-%m'),
            'reason': f'Reset manual do {card.get("name", "Cartão de Crédito")}',
            'expense': abs(reset_amount) if reset_amount < 0 else 0,
            'income': abs(reset_amount) if reset_amount > 0 else 0,
            'account_id': card_id,
            'user_id': user_id,
            'transaction_type': 'manual_reset',
            'created_at': datetime.now(timezone.utc)
        }
        
        transactions_collection.insert_one(transaction_data)
        
        return jsonify({
            'message': 'Reset manual executado com sucesso',
            'reset_amount': reset_amount,
            'new_balance': new_balance,
            'credit_limit': credit_limit
        })
    
    except Exception as e:
        return jsonify({'message': f'Erro ao executar reset manual: {str(e)}'}), 500

@credit_card_bp.route('/upcoming-resets', methods=['GET'])
def get_upcoming_resets():
    """Obtém lista de cartões com resets programados nos próximos 7 dias"""
    try:
        user_id = request.args.get('user_id') or 'temp_user'
        
        upcoming_resets = get_credit_cards_with_resets_due()
        
        # Filtra apenas os cartões do usuário atual
        user_upcoming = []
        for reset_info in upcoming_resets:
            card = reset_info['card']
            if card.get('user_id') == user_id:
                user_upcoming.append({
                    'card_id': str(card['_id']),
                    'card_name': card.get('name', 'Cartão de Crédito'),
                    'credit_limit': card.get('credit_limit', 0),
                    'current_balance': card.get('balance', 0),
                    'reset_date': reset_info['reset_date'].strftime('%Y-%m-%d'),
                    'days_until_reset': reset_info['days_until_reset'],
                    'auto_reset_day': card.get('auto_reset_day')
                })
        
        return jsonify({'upcoming_resets': user_upcoming})
    
    except Exception as e:
        return jsonify({'message': f'Erro ao buscar próximos resets: {str(e)}'}), 500

@credit_card_bp.route('/<card_id>/reset-history', methods=['GET'])
def get_reset_history_api(card_id):
    """Obtém histórico de resets de um cartão específico"""
    try:
        user_id = request.args.get('user_id') or 'temp_user'
        limit = int(request.args.get('limit', 10))
        
        # Verifica se o cartão pertence ao usuário
        card = accounts_collection.find_one({
            '_id': ObjectId(card_id),
            'type': 'cartao',
            'user_id': user_id
        })
        
        if not card:
            return jsonify({'message': 'Cartão de crédito não encontrado'}), 404
        
        reset_history = get_credit_card_reset_history(card_id, limit)
        
        return jsonify({'reset_history': reset_history})
    
    except Exception as e:
        return jsonify({'message': f'Erro ao buscar histórico de resets: {str(e)}'}), 500

@credit_card_bp.route('/test-reset', methods=['POST'])
def test_credit_card_reset():
    """Endpoint de teste para verificar configuração de reset automático"""
    try:
        data = request.get_json()
        test_card_id = data.get('card_id')
        
        if not test_card_id:
            return jsonify({'message': 'ID do cartão é obrigatório'}), 400
        
        # Busca o cartão
        card = accounts_collection.find_one({
            '_id': ObjectId(test_card_id),
            'type': 'cartao'
        })
        
        if not card:
            return jsonify({'message': 'Cartão de crédito não encontrado'}), 404
        
        # Calcula próximas datas de reset
        brazil_tz = pytz.timezone('America/Sao_Paulo')
        today = datetime.now(brazil_tz)
        
        reset_day = card.get('auto_reset_day', card.get('bill_closing_day'))
        if not reset_day:
            return jsonify({'message': 'Cartão não possui configuração de reset automático'}), 400
        
        # Próximo reset
        next_reset_month = today.replace(day=1)
        if today.day > reset_day:
            # Próximo mês
            if today.month == 12:
                next_reset_month = today.replace(year=today.year + 1, month=1, day=1)
            else:
                next_reset_month = today.replace(month=today.month + 1, day=1)
        
        next_reset_date = next_reset_month.replace(day=reset_day)
        
        # Último reset (se houver)
        last_reset = card.get('last_reset_date')
        if isinstance(last_reset, str):
            last_reset = datetime.fromisoformat(last_reset.replace('Z', '+00:00'))
        
        return jsonify({
            'card_name': card.get('name', 'Cartão de Crédito'),
            'credit_limit': card.get('credit_limit', 0),
            'auto_reset_enabled': card.get('auto_reset', False),
            'reset_day': reset_day,
            'next_reset_date': next_reset_date.strftime('%Y-%m-%d'),
            'days_until_next_reset': (next_reset_date - today).days,
            'last_reset_date': last_reset.strftime('%Y-%m-%d') if last_reset else None,
            'last_reset_amount': card.get('last_reset_amount', 0)
        })
    
    except Exception as e:
        return jsonify({'message': f'Erro ao testar configuração: {str(e)}'}), 500

@credit_card_bp.route('/stats', methods=['GET'])
def get_credit_card_stats():
    """Obtém estatísticas gerais dos cartões de crédito"""
    try:
        user_id = request.args.get('user_id') or 'temp_user'
        
        # Busca todos os cartões do usuário
        credit_cards = list(accounts_collection.find({
            'type': 'cartao',
            'user_id': user_id
        }))
        
        if not credit_cards:
            return jsonify({
                'total_cards': 0,
                'cards_with_auto_reset': 0,
                'total_credit_limit': 0,
                'total_current_balance': 0,
                'total_available_credit': 0,
                'upcoming_resets_count': 0
            })
        
        stats = {
            'total_cards': len(credit_cards),
            'auto_reset_cards_count': len([card for card in credit_cards if card.get('auto_reset', False)]),
            'total_credit_limit': sum(card.get('credit_limit', 0) for card in credit_cards),
            'total_current_balance': sum(card.get('balance', 0) for card in credit_cards),
            'total_available_credit': sum(
                card.get('credit_limit', 0) - card.get('balance', 0) 
                for card in credit_cards
            )
        }
        
        # Calcula crédito utilizado
        stats['credit_utilization_rate'] = (
            stats['total_current_balance'] / stats['total_credit_limit'] * 100
            if stats['total_credit_limit'] > 0 else 0
        )
        
        # Próximos resets
        upcoming_resets = get_credit_cards_with_resets_due()
        stats['upcoming_resets_count'] = sum(
            1 for reset_info in upcoming_resets 
            if reset_info['card'].get('user_id') == user_id
        )
        
        return jsonify(stats)
    
    except Exception as e:
        return jsonify({'message': f'Erro ao buscar estatísticas: {str(e)}'}), 500

# Adicionar o blueprint ao app na função de registro
def register_credit_card_routes(app):
    """Registra as rotas de cartão de crédito no app Flask"""
    app.register_blueprint(credit_card_bp)
    
    # Inicia o agendador automático
    try:
        start_credit_card_scheduler()
        print("✅ Agendador de reset automático iniciado com sucesso")
    except Exception as e:
        print(f"⚠️ Erro ao iniciar agendador: {e}")

if __name__ == "__main__":
    # Teste das rotas
    print("🧪 Testando rotas de cartão de crédito...")
    
    # Simula requisição de teste
    from flask import Flask
    app = Flask(__name__)
    
    with app.app_context():
        register_credit_card_routes(app)
        
        with app.test_client() as client:
            response = client.get('/api/credit-card/')
            print(f"Status: {response.status_code}")
    
    print("✅ Teste das rotas concluído!")
