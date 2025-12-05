# credit_card_manager.py
"""
Sistema de gerenciamento de reset automático para cartões de crédito
"""

import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient
from bson import ObjectId
import pytz

# Importar variáveis do app principal
try:
    from app import db, accounts_collection, transactions_collection, accounts_collection
except ImportError:
    print("⚠️ Usando configuração standalone para desenvolvimento")
    # Fallback para desenvolvimento independente
    MONGODB_URI = os.environ.get('MONGODB_URI', 'mongodb://localhost:27017/')
    DATABASE_NAME = os.environ.get('DATABASE_NAME', 'financial_organizer')
    client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
    db = client[DATABASE_NAME]
    accounts_collection = db.accounts
    transactions_collection = db.transactions

class CreditCardManager:
    """
    Gerenciador de reset automático para cartões de crédito
    """
    
    def __init__(self):
        self.brazil_tz = pytz.timezone('America/Sao_Paulo')
        self.scheduler_thread = None
        self.scheduler_running = False
        
    def start_scheduler(self):
        """Inicia o agendador automático"""
        if not self.scheduler_running:
            self.scheduler_running = True
            self.scheduler_thread = threading.Thread(target=self._scheduler_loop, daemon=True)
            self.scheduler_thread.start()
            print("🔄 Agendador de reset automático iniciado")
    
    def stop_scheduler(self):
        """Para o agendador automático"""
        self.scheduler_running = False
        if self.scheduler_thread:
            self.scheduler_thread.join()
        print("⏹️ Agendador de reset automático parado")
    
    def _scheduler_loop(self):
        """Loop do agendador que verifica cartões que precisam ser resetados"""
        while self.scheduler_running:
            try:
                self._check_credit_cards_for_reset()
                # Verifica a cada 6 horas
                time.sleep(6 * 3600)
            except Exception as e:
                print(f"❌ Erro no agendador de reset: {e}")
                time.sleep(3600)  # Aguarda 1 hora em caso de erro
    
    def _check_credit_cards_for_reset(self):
        """Verifica quais cartões precisam ser resetados hoje"""
        today = datetime.now(self.brazil_tz)
        today_day = today.day
        
        # Busca todos os cartões de crédito com reset automático habilitado
        credit_cards = list(accounts_collection.find({
            'type': 'cartao',
            'auto_reset': True,
            'bill_closing_day': {'$exists': True, '$ne': None}
        }))
        
        for card in credit_cards:
            try:
                closing_day = card.get('bill_closing_day')
                auto_reset_day = card.get('auto_reset_day', closing_day)
                
                # Verifica se é o dia do reset
                if today_day == auto_reset_day:
                    self._reset_credit_card(card)
            except Exception as e:
                print(f"❌ Erro ao processar cartão {card.get('_id', 'unknown')}: {e}")
    
    def _reset_credit_card(self, credit_card):
        """
        Executa o reset de um cartão de crédito
        
        Args:
            credit_card (dict): Documento do cartão de crédito
        """
        try:
            card_id = str(credit_card['_id'])
            user_id = credit_card['user_id']
            current_balance = credit_card.get('balance', 0)
            credit_limit = credit_card.get('credit_limit', 0)
            card_name = credit_card.get('name', 'Cartão de Crédito')
            
            # Calcula o valor a ser zerado
            reset_amount = -current_balance
            
            # Define o novo saldo para o limite do cartão
            new_balance = credit_limit
            
            # Atualiza o saldo do cartão
            accounts_collection.update_one(
                {'_id': ObjectId(card_id)},
                {
                    '$set': {
                        'balance': new_balance,
                        'last_reset_date': datetime.now(self.brazil_tz),
                        'last_reset_amount': reset_amount,
                        'updated_at': datetime.now(self.brazil_tz)
                    },
                    '$push': {
                        'reset_history': {
                            'date': datetime.now(self.brazil_tz),
                            'reset_amount': reset_amount,
                            'new_balance': new_balance,
                            'credit_limit': credit_limit
                        }
                    }
                }
            )
            
            # Cria uma transação de registro para rastreamento
            transaction_data = {
                'month': datetime.now(self.brazil_tz).strftime('%Y-%m'),
                'reason': f'Reset automático do {card_name}',
                'expense': abs(reset_amount) if reset_amount < 0 else 0,
                'income': abs(reset_amount) if reset_amount > 0 else 0,
                'account_id': card_id,
                'user_id': user_id,
                'transaction_type': 'auto_reset',
                'created_at': datetime.now(self.brazil_tz)
            }
            
            transactions_collection.insert_one(transaction_data)
            
            print(f"✅ Reset automático executado: {card_name} - R$ {reset_amount:.2f}")
            
        except Exception as e:
            print(f"❌ Erro ao resetar cartão {credit_card.get('_id', 'unknown')}: {e}")
    
    def configure_credit_card_limit(self, card_id, credit_limit):
        """
        Configura o limite de crédito de um cartão
        
        Args:
            card_id (str): ID do cartão
            credit_limit (float): Novo limite de crédito
        """
        try:
            accounts_collection.update_one(
                {'_id': ObjectId(card_id)},
                {
                    '$set': {
                        'credit_limit': float(credit_limit),
                        'updated_at': datetime.now(self.brazil_tz)
                    }
                }
            )
            print(f"✅ Limite do cartão atualizado: R$ {credit_limit:.2f}")
        except Exception as e:
            print(f"❌ Erro ao configurar limite: {e}")
    
    def configure_credit_card_billing(self, card_id, closing_day, reset_day=None):
        """
        Configura o dia de fechamento e reset de um cartão
        
        Args:
            card_id (str): ID do cartão
            closing_day (int): Dia de fechamento da fatura
            reset_day (int, optional): Dia para executar o reset (padrão = closing_day)
        """
        try:
            if reset_day is None:
                reset_day = closing_day
            
            accounts_collection.update_one(
                {'_id': ObjectId(card_id)},
                {
                    '$set': {
                        'bill_closing_day': int(closing_day),
                        'auto_reset_day': int(reset_day),
                        'auto_reset': True,
                        'updated_at': datetime.now(self.brazil_tz)
                    }
                }
            )
            print(f"✅ Configuração de faturamento atualizada: Fechamento dia {closing_day}, Reset dia {reset_day}")
        except Exception as e:
            print(f"❌ Erro ao configurar faturamento: {e}")
    
    def disable_auto_reset(self, card_id):
        """Desabilita o reset automático para um cartão"""
        try:
            accounts_collection.update_one(
                {'_id': ObjectId(card_id)},
                {
                    '$set': {
                        'auto_reset': False,
                        'updated_at': datetime.now(self.brazil_tz)
                    }
                }
            )
            print(f"✅ Reset automático desabilitado para cartão {card_id}")
        except Exception as e:
            print(f"❌ Erro ao desabilitar reset automático: {e}")
    
    def get_reset_history(self, card_id, limit=10):
        """
        Obtém o histórico de resets de um cartão
        
        Args:
            card_id (str): ID do cartão
            limit (int): Limite de registros a retornar
        """
        try:
            card = accounts_collection.find_one({'_id': ObjectId(card_id)})
            if card and 'reset_history' in card:
                return card['reset_history'][-limit:]  # Retorna os últimos N resets
            return []
        except Exception as e:
            print(f"❌ Erro ao obter histórico: {e}")
            return []
    
    def get_credit_cards_needing_reset(self):
        """Retorna lista de cartões que precisam de reset nos próximos 7 dias"""
        today = datetime.now(self.brazil_tz)
        upcoming_cards = []
        
        # Próximos 7 dias
        for i in range(7):
            target_date = today + timedelta(days=i)
            target_day = target_date.day
            
            cards = list(accounts_collection.find({
                'type': 'cartao',
                'auto_reset': True,
                'auto_reset_day': target_day
            }))
            
            for card in cards:
                upcoming_cards.append({
                    'card': card,
                    'reset_date': target_date,
                    'days_until_reset': i
                })
        
        return sorted(upcoming_cards, key=lambda x: x['days_until_reset'])

# Instância global do gerenciador
credit_card_manager = CreditCardManager()

# Funções de conveniência para uso no app.py
def start_credit_card_scheduler():
    """Inicia o agendador de reset automático"""
    credit_card_manager.start_scheduler()

def stop_credit_card_scheduler():
    """Para o agendador de reset automático"""
    credit_card_manager.stop_scheduler()

def configure_credit_card(card_id, credit_limit=None, closing_day=None, reset_day=None):
    """Configura um cartão de crédito"""
    if credit_limit is not None:
        credit_card_manager.configure_credit_card_limit(card_id, credit_limit)
    
    if closing_day is not None:
        credit_card_manager.configure_credit_card_billing(card_id, closing_day, reset_day)

def get_credit_card_reset_history(card_id, limit=10):
    """Obtém histórico de resets de um cartão"""
    return credit_card_manager.get_reset_history(card_id, limit)

def get_credit_cards_with_resets_due():
    """Obtém cartões com resets programados"""
    return credit_card_manager.get_credit_cards_needing_reset()

if __name__ == "__main__":
    # Testestandalone
    print("🧪 Testando Credit Card Manager...")
    
    # Teste de configuração
    test_card_id = "64f7a8b9c2d1e3f4a5b6c7d8"  # ID de teste
    
    # configuração de exemplo
    credit_card_manager.configure_credit_card_limit(test_card_id, 5000)
    credit_card_manager.configure_credit_card_billing(test_card_id, 10, 15)
    
    # Verificar próximos resets
    upcoming = credit_card_manager.get_credit_cards_needing_reset()
    print(f"📅 Próximos resets: {len(upcoming)} cartões")
    
    # Iniciar scheduler (comentado para teste)
    # credit_card_manager.start_scheduler()
    
    print("✅ Teste concluído!")