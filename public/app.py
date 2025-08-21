from flask import Flask, request, jsonify, make_response, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
import uuid
import csv
import io
import os
import re
import json
from datetime import datetime

# Load tunnel URL from JSON file and set up CORS
def load_tunnel_url():
    try:
        # unify filename with front-end and run_tunnel.sh
        filepath = os.path.join(os.path.dirname(__file__), 'cf_url.json')
        with open(filepath, 'r') as f:
            data = json.load(f)
            return data.get('cf_url', '')
    except Exception as e:
        print(f"⚠️  Could not load tunnel URL: {e}")
        return ''

tunnel_url = load_tunnel_url()
allowed_origins = ["http://localhost:3000", "http://127.0.0.1:3000", "https://stock-chi-jet.vercel.app"]
if tunnel_url:
    allowed_origins.extend([tunnel_url, tunnel_url.replace("https://", "http://")])
    print(f"✅ CORS configured with tunnel URL: {tunnel_url}")

app = Flask(__name__)
# Use the computed allowed_origins so the tunnel origin is allowed when available
CORS(app, origins=allowed_origins, 
     methods=["GET", "POST", "DELETE", "OPTIONS"],
     allow_headers=["Content-Type", "Authorization"])

# app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+pymysql://root:test1234@localhost:3305/stockdb'
app.config['SQLALCHEMY_DATABASE_URI'] = 'postgresql+psycopg2://postgres:test1234@localhost:5432/stockdb'
# app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+pymysql://root:anuarjunrajesh@localhost:3306/stockdb'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

tokens = {}
print("Server starting - clearing all authentication tokens")
tokens.clear()

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True)
    password = db.Column(db.String(50))
    is_admin = db.Column(db.Boolean, default=False)

class Trades(db.Model):
    __tablename__ = 'trades'
    id = db.Column(db.Integer, primary_key=True)
    ticker = db.Column(db.String(10), nullable=False)
    exchange = db.Column(db.Integer, nullable=False)
    participant_timestamp = db.Column(db.BigInteger, nullable=False)
    price = db.Column(db.REAL, nullable=False)
    trade_size = db.Column(db.Integer, nullable=False)
    #----modified----
    del_t = db.Column(db.BigInteger, nullable=True)
    del_p = db.Column(db.REAL, nullable=True)
    #----modified----

with app.app_context():
    db.create_all()
    if not User.query.filter_by(username='admin').first():
        admin = User(username='admin', password='admin123', is_admin=True)
        db.session.add(admin)
        db.session.commit()
    user = User.query.filter_by(username='admin').first()
    print(user.is_admin)

def expression_to_sql(expression):
    """Convert a mathematical expression with PRICE/SIZE to SQL"""
    try:
        # Clean the expression
        expr = expression.upper().strip()
        
        # Replace PRICE and SIZE with column names
        sql_expr = expr.replace('PRICE', 'price').replace('SIZE', 'trade_size')
        
        # Convert ^ to POWER function for SQL
        # Handle power operations: convert a^b to POWER(a,b)
        power_pattern = r'([^+\-*/^()]+)\s*\^\s*([^+\-*/^()]+)'
        while re.search(power_pattern, sql_expr):
            sql_expr = re.sub(power_pattern, r'POWER(\1,\2)', sql_expr)
        
        # Validate that we only have safe SQL operations
        if not re.match(r'^[0-9a-z_+\-*/().,\s]+$', sql_expr.lower()):
            return None
            
        return sql_expr
        
    except Exception as e:
        print(f"Error converting expression to SQL: {e}")
        return None

def evaluate_expression(expression, price, size):
    """Fallback function for individual row evaluation (should rarely be used now)"""
    try:
        # Replace PRICE and SIZE with actual values (case insensitive)
        expr = expression.upper().replace('PRICE', str(price)).replace('SIZE', str(size))
        
        # Validate characters - only allow numbers, operators, parentheses, dots, and spaces
        if not re.match(r'^[0-9+\-*/^().\s]+$', expr):
            return 0
        
        # Convert ^ to ** for Python exponentiation
        expr = expr.replace('^', '**')
        
        # Remove extra spaces for cleaner evaluation
        expr = re.sub(r'\s+', '', expr)
        
        # Evaluate the expression
        result = eval(expr)
        
        # Handle special cases
        if result is None or str(result) in ['inf', '-inf', 'nan']:
            return 0
            
        return round(float(result), 6)
        
    except ZeroDivisionError:
        return 0
    except (ValueError, SyntaxError, TypeError) as e:
        return 0
    except Exception as e:
        return 0

def generate_column_name(expression):
    """Generate a clean column name from the equation expression"""
    # Start with the cleaned expression
    name = expression.upper()

    # Replace operators with readable names
    name = name.replace(' + ', '_PLUS_')
    name = name.replace(' - ', '_MINUS_')
    name = name.replace(' * ', '_MULT_')
    name = name.replace(' / ', '_DIV_')
    name = name.replace(' ^ ', '_POW_')

    # Handle unary minus at start: -PRICE becomes NEG_PRICE
    name = re.sub(r'^-\s*', 'NEG_', name)

    # Handle parentheses
    name = name.replace('(', '_OPEN_')
    name = name.replace(')', '_CLOSE_')

    # Handle decimal points
    name = name.replace('.', 'DOT')

    # Remove extra spaces and replace with underscores
    name = re.sub(r'\s+', '_', name.strip())

    # Clean up multiple underscores
    name = re.sub(r'_{2,}', '_', name)

    # Remove leading/trailing underscores
    name = name.strip('_')
    
    # Ensure we have a valid name
    if not name:
        name = 'CUSTOM_CALC'
    
    return name

#----modified----
def get_time_bucket_expression(aggregate_by):
    """Generate SQL expression for time bucketing based on aggregation level"""
    if aggregate_by == 'ns':
        # No aggregation needed for nanoseconds
        return "participant_timestamp"
    elif aggregate_by == 'ms':
        # Truncate to milliseconds (remove last 6 digits)
        return "(participant_timestamp / 1000000) * 1000000"
    elif aggregate_by == 's':
        # Truncate to seconds using PostgreSQL date_trunc
        return "EXTRACT(EPOCH FROM date_trunc('second', to_timestamp(participant_timestamp / 1000000000.0))) * 1000000000"
    elif aggregate_by == 'min':
        # Truncate to minutes
        return "EXTRACT(EPOCH FROM date_trunc('minute', to_timestamp(participant_timestamp / 1000000000.0))) * 1000000000"
    elif aggregate_by == 'hr':
        # Truncate to hours
        return "EXTRACT(EPOCH FROM date_trunc('hour', to_timestamp(participant_timestamp / 1000000000.0))) * 1000000000"
    elif aggregate_by == 'day':
        # Truncate to days
        return "EXTRACT(EPOCH FROM date_trunc('day', to_timestamp(participant_timestamp / 1000000000.0))) * 1000000000"
    else:
        return "participant_timestamp"
#----modified----

def cleanup_trade_csv_files():
    try:
        current_dir = os.path.dirname(__file__)
        for filename in os.listdir(current_dir):
            if filename.startswith('trades_') and filename.endswith('.csv'):
                filepath = os.path.join(current_dir, filename)
                try:
                    os.remove(filepath)
                    print(f"Deleted existing trade CSV file: {filename}")
                except Exception as e:
                    print(f"Error deleting file {filename}: {e}")
    except Exception as e:
        print(f"Error during CSV cleanup: {e}")

def require_auth(f):
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Missing or invalid token'}), 401
        token = auth_header.split()[1]
        if token not in tokens:
            return jsonify({'error': 'Invalid token'}), 403
        request.user = tokens[token]
        return f(*args, **kwargs)
    return wrapper

def require_admin(f):
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = request.user
        if not user or not user.is_admin:
            return jsonify({'error': 'Admin only'}), 403
        return f(*args, **kwargs)
    return wrapper

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(username=data['username'], password=data['password']).first()
    if user:
        token = str(uuid.uuid4())
        tokens[token] = user
        return jsonify({'token': token, 'is_admin': user.is_admin})
    return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/create-user', methods=['POST'])
def create_user():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Missing or invalid token'}), 401
    token = auth_header.split()[1]
    if token not in tokens:
        return jsonify({'error': 'Invalid token'}), 403
    user = tokens[token]
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin only'}), 403
    data = request.json
    if User.query.filter_by(username=data['username']).first():
        return jsonify({'error': f'Username "{data["username"]}" already exists. Please choose a different username.'}), 400
    new_user = User(username=data['username'], password=data['password'], is_admin=bool(data.get('is_admin', False)))
    db.session.add(new_user)
    db.session.commit()
    return jsonify({'status': 'User created successfully'})

@app.route('/get-users', methods=['GET'])
def get_users():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Missing or invalid token'}), 401
    token = auth_header.split()[1]
    if token not in tokens:
        return jsonify({'error': 'Invalid token'}), 403
    current_user = tokens[token]
    if not current_user or not current_user.is_admin:
        return jsonify({'error': 'Admin only'}), 403
    if current_user.username == 'admin':
        users = User.query.all()
    else:
        users = User.query.filter(User.username != 'admin').all()
    user_list = []
    for user_item in users:
        if user_item.username == 'admin':
            display_type = 'Root'
        elif user_item.id == current_user.id:
            display_type = 'Self'
        elif user_item.is_admin:
            display_type = 'Admin'
        else:
            display_type = 'User'
        user_list.append({
            'id': user_item.id,
            'username': user_item.username,
            'is_admin': user_item.is_admin,
            'display_type': display_type,
            'is_self': user_item.id == current_user.id
        })

    def sort_users(user_item):
        if user_item['is_self']:
            return (0, '')
        elif user_item['display_type'] == 'Root':
            return (1, '')
        elif user_item['is_admin']:
            return (2, user_item['username'])
        else:
            return (3, user_item['username'])
    
    user_list.sort(key=sort_users)
    return jsonify({'users': user_list})

@app.route('/delete-user', methods=['DELETE'])
def delete_user():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Missing or invalid token'}), 401
    token = auth_header.split()[1]
    if token not in tokens:
        return jsonify({'error': 'Invalid token'}), 403
    user = tokens[token]
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin only'}), 403
    data = request.json
    user_id = data.get('user_id')
    if not user_id:
        return jsonify({'error': 'User ID is required'}), 400
    target_user = User.query.get(user_id)
    if not target_user:
        return jsonify({'error': 'User not found'}), 404
    if target_user.username == 'admin':
        return jsonify({'error': 'Cannot delete the main admin user'}), 400
    if user.username != 'admin' and target_user.is_admin:
        return jsonify({'error': 'Only the root admin can delete other admin users'}), 403
    db.session.delete(target_user)
    db.session.commit()
    return jsonify({'status': f'User "{target_user.username}" deleted successfully'})

@app.route('/change-password', methods=['POST'])
def change_password():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Missing or invalid token'}), 401
    token = auth_header.split()[1]
    if token not in tokens:
        return jsonify({'error': 'Invalid token'}), 403
    current_user = tokens[token]
    if not current_user or not current_user.is_admin:
        return jsonify({'error': 'Admin only'}), 403
    data = request.json
    user_id = data.get('user_id')
    new_password = data.get('new_password')
    current_password = data.get('current_password')
    if not user_id or not new_password:
        return jsonify({'error': 'User ID and new password are required'}), 400
    target_user = User.query.get(user_id)
    if not target_user:
        return jsonify({'error': 'User not found'}), 404
    if current_user.username == 'admin':
        target_user.password = new_password
        db.session.commit()
        return jsonify({'status': f'Password changed successfully for user "{target_user.username}"'})
    if target_user.is_admin:
        return jsonify({'error': 'You can only change passwords for regular users, not other admins'}), 403
    if not current_password:
        return jsonify({'error': 'Current password is required'}), 400
    if target_user.password != current_password:
        return jsonify({'error': 'Current password is incorrect'}), 400
    target_user.password = new_password
    db.session.commit()
    return jsonify({'status': f'Password changed successfully for user "{target_user.username}"'})

@app.route('/query', methods=['POST'])
def query():
    cleanup_trade_csv_files()
    data = request.json
    EXCHANGE_NAME_TO_ID = {
        "Nasdaq OMX BX, Inc.": 2,
        "Nasdaq": 12,
        "Nasdaq Philadelphia Exchange LLC": 17,
        "FINRA Nasdaq TRF Carteret": 202,
        "FINRA Nasdaq TRF Chicago": 203
    }
    EXCHANGE_ID_TO_CODE = {
        2: "XBOS",
        12: "XNAS", 
        17: "XPHL",
        202: "FINN",
        203: "FINC"
    }
    exchanges = data.get('exchanges', [])
    exchange_ids = []
    if exchanges:
        for exchange_name in exchanges:
            if exchange_name in EXCHANGE_NAME_TO_ID:
                exchange_ids.append(EXCHANGE_NAME_TO_ID[exchange_name])
    pricelow = data.get('pricelow')
    pricehigh = data.get('pricehigh')
    sizelow = data.get('sizelow')
    sizehigh = data.get('sizehigh')
    datelow_str = data.get('datelow')
    datehigh_str = data.get('datehigh')
    operations = data.get('operations', [])
    sortby = data.get('sortby', 'timenew')
    #----modified----
    aggregateby = data.get('aggregateby')
    #----modified----

    # Debug: print received operations
    print(f"Received {len(operations)} operations:")
    for i, op in enumerate(operations):
        print(f"  Operation {i+1}: expression='{op.get('expression')}'")
        # Generate and show the column name that will be used
        column_name = generate_column_name(op.get('expression', ''))
        print(f"    Generated column name: '{column_name}'")
    
    #----modified----
    print(f"Aggregation mode: {'Enabled' if aggregateby else 'Disabled'}")
    if aggregateby:
        print(f"Aggregate by: {aggregateby}")
    #----modified----

    datelow = None
    datehigh = None
    if datelow_str:
        try:
            dt = datetime.strptime(datelow_str, '%Y-%m-%d')
            datelow = int(dt.timestamp() * 1_000_000_000)
        except ValueError:
            return jsonify({'error': 'Invalid datelow format. Use YYYY-MM-DD format (e.g., 2020-12-08)'}), 400
    if datehigh_str:
        try:
            dt = datetime.strptime(datehigh_str, '%Y-%m-%d')
            dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
            datehigh = int(dt.timestamp() * 1_000_000_000)
        except ValueError:
            return jsonify({'error': 'Invalid datehigh format. Use YYYY-MM-DD format (e.g., 2020-12-08)'}), 400
    #----modified----
    query_obj = db.session.query(
        Trades.ticker,
        Trades.exchange,
        Trades.participant_timestamp,
        Trades.price,
        Trades.trade_size,
        Trades.del_t,
        Trades.del_p
    )
    #----modified----
    if exchange_ids:
        query_obj = query_obj.filter(Trades.exchange.in_(exchange_ids))
    if pricelow is not None:
        query_obj = query_obj.filter(Trades.price >= pricelow)
    if pricehigh is not None:
        query_obj = query_obj.filter(Trades.price <= pricehigh)
    if sizelow is not None:
        query_obj = query_obj.filter(Trades.trade_size >= sizelow)
    if sizehigh is not None:
        query_obj = query_obj.filter(Trades.trade_size <= sizehigh)
    if datelow is not None:
        query_obj = query_obj.filter(Trades.participant_timestamp >= datelow)
    if datehigh is not None:
        query_obj = query_obj.filter(Trades.participant_timestamp <= datehigh)
    if sortby == 'timenew':
        query_obj = query_obj.order_by(Trades.participant_timestamp.desc())
    elif sortby == 'timeold':
        query_obj = query_obj.order_by(Trades.participant_timestamp.asc())
    elif sortby == 'sizedesc':
        query_obj = query_obj.order_by(Trades.trade_size.desc())
    elif sortby == 'sizeasc':
        query_obj = query_obj.order_by(Trades.trade_size.asc())
    elif sortby == 'pricedesc':
        query_obj = query_obj.order_by(Trades.price.desc())
    elif sortby == 'priceasc':
        query_obj = query_obj.order_by(Trades.price.asc())
    filename = f"trades_{uuid.uuid4().hex[:8]}_{int(datetime.now().timestamp())}.csv"
    filepath = os.path.join(os.path.dirname(__file__), filename)
    
    try:
        # Build the SQL query with calculated columns
        #----modified----
        base_columns = [
            Trades.ticker,
            Trades.exchange,
            Trades.participant_timestamp,
            Trades.price,
            Trades.trade_size,
            Trades.del_t,
            Trades.del_p
        ]
        #----modified----
        
        # Add calculated columns using SQL expressions
        calculated_expressions = []
        sql_columns = list(base_columns)
        
        for i, operation in enumerate(operations):
            sql_expr = expression_to_sql(operation['expression'])
            if sql_expr:
                calculated_expressions.append(sql_expr)
                # Add the calculated column to the query
                sql_columns.append(db.text(f"({sql_expr}) as calc_{i}"))
            else:
                # Mark for Python fallback evaluation
                calculated_expressions.append(None)
        
        #----modified----
        # Determine if we need aggregation
        if aggregateby and operations:
            # Aggregation mode
            time_bucket_expr = get_time_bucket_expression(aggregateby)
            
            # Build aggregation query
            agg_columns = [
                db.text(f"({time_bucket_expr}) as time_bucket")
            ]
            
            # Add sum and avg for each derived calculation
            for i, operation in enumerate(operations):
                sql_expr = expression_to_sql(operation['expression'])
                if sql_expr:
                    agg_columns.append(db.text(f"SUM({sql_expr}) as calc_{i}_sum"))
                    agg_columns.append(db.text(f"SUM({sql_expr}) / SUM(trade_size) as calc_{i}_avg"))
                else:
                    # For fallback expressions, we'll need to handle differently
                    agg_columns.append(db.text(f"0 as calc_{i}_sum"))
                    agg_columns.append(db.text(f"0 as calc_{i}_avg"))
            
            # Build aggregation query
            query_obj = db.session.query(*agg_columns)
            
            # Apply filters
            if exchange_ids:
                query_obj = query_obj.filter(Trades.exchange.in_(exchange_ids))
            if pricelow is not None:
                query_obj = query_obj.filter(Trades.price >= pricelow)
            if pricehigh is not None:
                query_obj = query_obj.filter(Trades.price <= pricehigh)
            if sizelow is not None:
                query_obj = query_obj.filter(Trades.trade_size >= sizelow)
            if sizehigh is not None:
                query_obj = query_obj.filter(Trades.trade_size <= sizehigh)
            if datelow is not None:
                query_obj = query_obj.filter(Trades.participant_timestamp >= datelow)
            if datehigh is not None:
                query_obj = query_obj.filter(Trades.participant_timestamp <= datehigh)
            
            # Group by time bucket
            query_obj = query_obj.group_by(db.text(f"({time_bucket_expr})"))
            
            # Order by time bucket (chronological)
            query_obj = query_obj.order_by(db.text(f"({time_bucket_expr})"))
            
        else:
            # Non-aggregation mode (original behavior)
            # Build the query with all columns
            query_obj = db.session.query(*sql_columns)
            
            # Apply filters
            if exchange_ids:
                query_obj = query_obj.filter(Trades.exchange.in_(exchange_ids))
            if pricelow is not None:
                query_obj = query_obj.filter(Trades.price >= pricelow)
            if pricehigh is not None:
                query_obj = query_obj.filter(Trades.price <= pricehigh)
            if sizelow is not None:
                query_obj = query_obj.filter(Trades.trade_size >= sizelow)
            if sizehigh is not None:
                query_obj = query_obj.filter(Trades.trade_size <= sizehigh)
            if datelow is not None:
                query_obj = query_obj.filter(Trades.participant_timestamp >= datelow)
            if datehigh is not None:
                query_obj = query_obj.filter(Trades.participant_timestamp <= datehigh)
            
            # Apply sorting
            if sortby == 'timenew':
                query_obj = query_obj.order_by(Trades.participant_timestamp.desc())
            elif sortby == 'timeold':
                query_obj = query_obj.order_by(Trades.participant_timestamp.asc())
            elif sortby == 'sizedesc':
                query_obj = query_obj.order_by(Trades.trade_size.desc())
            elif sortby == 'sizeasc':
                query_obj = query_obj.order_by(Trades.trade_size.asc())
            elif sortby == 'pricedesc':
                query_obj = query_obj.order_by(Trades.price.desc())
            elif sortby == 'priceasc':
                query_obj = query_obj.order_by(Trades.price.asc())
        #----modified----

        with open(filepath, 'w', newline='', encoding='utf-8') as csvfile:
            writer = csv.writer(csvfile)
            
            #----modified----
            if aggregateby and operations:
                # Aggregation mode CSV header
                header = ['date', 'time']
                for operation in operations:
                    column_name = generate_column_name(operation['expression'])
                    header.append(f"{column_name}_sum")
                    header.append(f"{column_name}_avg")
                writer.writerow(header)
                
                # Process aggregated data
                trades_chunk = query_obj.all()
                
                for row in trades_chunk:
                    # Extract time bucket (first column)
                    time_bucket = int(row[0])
                    
                    # Format timestamp based on aggregation level
                    timestamp_seconds = time_bucket / 1_000_000_000
                    dt = datetime.fromtimestamp(timestamp_seconds)
                    date = dt.strftime('%Y-%m-%d')
                    
                    if aggregateby == 'day':
                        time = '00:00:00'
                    elif aggregateby == 'hr':
                        time = dt.strftime('%H:00:00')
                    elif aggregateby == 'min':
                        time = dt.strftime('%H:%M:00')
                    elif aggregateby == 's':
                        time = dt.strftime('%H:%M:%S')
                    elif aggregateby == 'ms':
                        nanoseconds = time_bucket % 1_000_000_000
                        milliseconds = nanoseconds // 1_000_000
                        time = dt.strftime('%H:%M:%S') + f'.{milliseconds:03d}'
                    else:  # ns
                        nanoseconds = time_bucket % 1_000_000_000
                        time = dt.strftime('%H:%M:%S') + f'.{nanoseconds:09d}'
                    
                    # Build row data
                    row_data = [date, time]
                    
                    # Add sum and avg for each operation
                    for i in range(len(operations)):
                        sum_value = row[1 + i * 2] if len(row) > 1 + i * 2 else 0
                        avg_value = row[2 + i * 2] if len(row) > 2 + i * 2 else 0
                        row_data.append(round(float(sum_value), 6) if sum_value is not None else 0)
                        row_data.append(round(float(avg_value), 6) if avg_value is not None else 0)
                    
                    writer.writerow(row_data)
            else:
                # Non-aggregation mode CSV header
                header = ['ticker', 'exchange', 'date', 'time', 'price', 'size', 'del_t', 'del_p']
                for operation in operations:
                    column_name = generate_column_name(operation['expression'])
                    header.append(column_name)
                writer.writerow(header)
                
                # Process data in chunks for memory efficiency
                offset = 0
                limit = 10000000  # Reduced chunk size for better memory management
                
                while True:
                    chunk_query = query_obj.offset(offset).limit(limit)
                    trades_chunk = chunk_query.all()
                    if not trades_chunk:
                        break
                    
                    for row in trades_chunk:
                        # Extract base columns (first 7 columns now)
                        ticker = row[0]
                        exchange = row[1] 
                        participant_timestamp = row[2]
                        price = row[3]
                        trade_size = row[4]
                        del_t = row[5]
                        del_p = row[6]
                        
                        # Format timestamp
                        timestamp_seconds = participant_timestamp / 1_000_000_000
                        dt = datetime.fromtimestamp(timestamp_seconds)
                        date = dt.strftime('%Y-%m-%d')
                        nanoseconds = participant_timestamp % 1_000_000_000
                        time = dt.strftime('%H:%M:%S') + f'.{nanoseconds:09d}'
                        exchange_code = EXCHANGE_ID_TO_CODE.get(exchange, str(exchange))
                        
                        # Build row data
                        row_data = [ticker, exchange_code, date, time, price, trade_size, del_t, del_p]
                        
                        # Add calculated columns
                        sql_calc_index = 7  # Start after the base 7 columns
                        for i, operation in enumerate(operations):
                            if calculated_expressions[i] is not None:
                                # Use SQL-calculated value (next column in result)
                                calculated_value = row[sql_calc_index]
                                sql_calc_index += 1
                                row_data.append(round(float(calculated_value), 6) if calculated_value is not None else 0)
                            else:
                                # Fallback to Python evaluation
                                result = evaluate_expression(operation['expression'], price, trade_size)
                                row_data.append(result)
                        
                        writer.writerow(row_data)
                    
                    offset += limit
                    if len(trades_chunk) < limit:
                        break
            #----modified----
        return jsonify({
            'status': 'success',
            'filename': filename,
            'filepath': filepath
        })
    except Exception as e:
        if os.path.exists(filepath):
            os.remove(filepath)
        return jsonify({'error': f'Error generating CSV: {str(e)}'}), 500

@app.route('/download/<filename>', methods=['GET'])
def download_file(filename):
    try:
        filepath = os.path.join(os.path.dirname(__file__), filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
        def remove_file():
            try:
                if os.path.exists(filepath):
                    os.remove(filepath)
            except:
                pass
        response = send_file(
            filepath, 
            as_attachment=True, 
            download_name='trades.csv',
            mimetype='text/csv'
        )
        response.call_on_close(remove_file)
        return response
    except Exception as e:
        return jsonify({'error': f'Error downloading file: {str(e)}'}), 500

if __name__ == '__main__':
    import signal
    import sys
    
    def signal_handler(sig, frame):
        print("\nServer stopping - clearing all authentication tokens")
        tokens.clear()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    print("Registered routes:")
    for rule in app.url_map.iter_rules():
        print(f"  {rule.endpoint}: {rule.rule} {rule.methods}")
    
    app.run(port=8000)