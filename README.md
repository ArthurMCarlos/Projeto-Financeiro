# 💰 Organizador Financeiro Pessoal

Aplicação web completa para gestão de finanças pessoais, com controle de transações, receitas, orçamentos, metas e cartões de crédito. Desenvolvida com Python (Flask) no backend e HTML/CSS/JavaScript no frontend, com banco de dados MongoDB Atlas.

---

## 🚀 Funcionalidades

- 🔐 **Autenticação segura** com JWT (login e cadastro)
- 💸 **Controle de transações** — despesas e receitas organizadas por categoria e mês
- 🏦 **Gerenciamento de contas** — contas correntes, poupança e cartões de crédito
- 💳 **Cartão de crédito inteligente** — reset automático do limite na data de fechamento
- 🔄 **Transferências entre contas** com reversão automática ao excluir
- 📊 **Orçamentos mensais** por categoria
- 🎯 **Metas de economia** com acompanhamento de progresso
- 📁 **Exportação de dados** em CSV e Excel
- 📥 **Importação de dados** via CSV/Excel
- 🌐 **Deploy na Render** — disponível online

---

## 🛠️ Tecnologias

| Camada | Tecnologia |
|---|---|
| Backend | Python 3, Flask, Flask-CORS |
| Autenticação | JWT (PyJWT), Werkzeug |
| Banco de Dados | MongoDB Atlas (pymongo) |
| Exportação | pandas, openpyxl, reportlab |
| Deploy | Render |

---

## ⚙️ Como rodar localmente

### Pré-requisitos

- Python 3.10+
- Conta no [MongoDB Atlas](https://www.mongodb.com/atlas) (gratuita)

### Instalação

```bash
# Clone o repositório
git clone https://github.com/ArthurMCarlos/Projeto-Financeiro.git
cd Projeto-Financeiro

# Instale as dependências
pip install -r requirements.txt
```

### Variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
MONGODB_URI=sua_connection_string_mongodb
DATABASE_NAME=financial_organizer
SECRET_KEY=sua_chave_secreta
PORT=5000
```

### Rodando o projeto

```bash
python app.py
```

Acesse em: `http://localhost:5000`

---

## 📁 Estrutura do projeto

```
Projeto-Financeiro/
├── app.py              # Backend Flask (API REST completa)
├── requirements.txt    # Dependências Python
├── render.yaml         # Configuração de deploy (Render)
├── index.html          # Tela principal
├── login.html          # Tela de login/cadastro
├── dashboard.html      # Dashboard financeiro
├── script.js           # Lógica do frontend (transações)
├── dashboard.js        # Lógica do dashboard
├── charts.js           # Gráficos e visualizações
├── goals.js            # Gerenciamento de metas
├── style.css           # Estilos globais
└── dashboard.css       # Estilos do dashboard
```

---

## 🔌 Principais endpoints da API

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/register` | Cadastro de usuário |
| POST | `/api/auth/login` | Login e geração de token |
| GET/POST | `/api/transactions` | Listar e criar transações |
| GET/POST | `/api/incomes` | Listar e criar receitas |
| GET/POST | `/api/accounts` | Listar e criar contas |
| GET/POST | `/api/budgets` | Listar e criar orçamentos |
| GET/POST | `/api/goals` | Listar e criar metas |
| POST | `/api/transfers` | Transferência entre contas |
| GET | `/api/export/csv` | Exportar dados em CSV |
| GET | `/api/export/excel` | Exportar dados em Excel |

---

## 👤 Autor

**Arthur M. Carlos**
- LinkedIn: [linkedin.com/in/arthurcarlos-1142242b6](https://www.linkedin.com/in/arthurcarlos-1142242b6)
- Email: arthur.m.carlos25@gmail.com
