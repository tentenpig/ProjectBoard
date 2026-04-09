CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nickname VARCHAR(20) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    exp INT NOT NULL DEFAULT 0,
    gold INT NOT NULL DEFAULT 0,
    last_login_reward DATE DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_equipment (
    user_id INT PRIMARY KEY,
    rod_key VARCHAR(50) NOT NULL DEFAULT 'basic_rod',
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS fishing_state (
    user_id INT PRIMARY KEY,
    location VARCHAR(20) DEFAULT NULL,
    cast_at BIGINT DEFAULT NULL,
    catch_at BIGINT DEFAULT NULL,
    fish_key VARCHAR(50) DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS fish_inventory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    fish_key VARCHAR(50) NOT NULL,
    caught_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sold BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_user_sold (user_id, sold)
);
