const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Список популярных Emoji для игроков
const EMOJIS = [
    '😀', '😎', '🤖', '👽', '🦄', '🐉', '🔥', '⚡', '🌟', '💎',
    '🍕', '🍔', '🍟', '🍩', '🍰', '🍭', '🎮', '🎯', '🎪', '🎨',
    '🚀', '🛸', '🚗', '🏎️', '🚲', '🛴', '🦋', '🐸', '🐙', '🦑'
];

class Game {
    constructor() {
        this.players = new Map();
        this.food = [];
        this.gameWidth = 3000;
        this.gameHeight = 3000;
        this.foodCount = 200;
        this.generateFood();
    }

    generateFood() {
        this.food = [];
        for (let i = 0; i < this.foodCount; i++) {
            this.food.push({
                x: Math.random() * this.gameWidth,
                y: Math.random() * this.gameHeight,
                emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
                size: 5
            });
        }
    }

    addPlayer(socketId, name) {
        const player = {
            id: socketId,
            name: name,
            x: Math.random() * this.gameWidth,
            y: Math.random() * this.gameHeight,
            size: 20,
            emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
            color: `hsl(${Math.random() * 360}, 70%, 60%)`,
            score: 0,
            speed: 3
        };
        this.players.set(socketId, player);
        return player;
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
    }

    updatePlayer(socketId, mouseX, mouseY) {
        const player = this.players.get(socketId);
        if (!player) return;

        // Вычисляем направление движения
        const dx = mouseX - player.x;
        const dy = mouseY - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 0) {
            // Нормализуем вектор и применяем скорость
            const speed = player.speed;
            player.x += (dx / distance) * speed;
            player.y += (dy / distance) * speed;

            // Ограничиваем движение в пределах игрового поля
            player.x = Math.max(player.size, Math.min(this.gameWidth - player.size, player.x));
            player.y = Math.max(player.size, Math.min(this.gameHeight - player.size, player.y));
        }
    }

    checkCollisions() {
        const playersArray = Array.from(this.players.values());
        
        for (let i = 0; i < playersArray.length; i++) {
            const player1 = playersArray[i];
            
            // Проверяем поедание еды
            for (let j = this.food.length - 1; j >= 0; j--) {
                const foodItem = this.food[j];
                const distance = Math.sqrt(
                    Math.pow(player1.x - foodItem.x, 2) + 
                    Math.pow(player1.y - foodItem.y, 2)
                );
                
                if (distance < player1.size + foodItem.size) {
                    player1.size += 1;
                    player1.score += 10;
                    player1.speed = Math.max(1, 3 - player1.size * 0.02);
                    this.food.splice(j, 1);
                    
                    // Добавляем новую еду
                    this.food.push({
                        x: Math.random() * this.gameWidth,
                        y: Math.random() * this.gameHeight,
                        emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
                        size: 5
                    });
                }
            }
            
            // Проверяем поедание других игроков
            for (let j = 0; j < playersArray.length; j++) {
                if (i === j) continue;
                
                const player2 = playersArray[j];
                const distance = Math.sqrt(
                    Math.pow(player1.x - player2.x, 2) + 
                    Math.pow(player1.y - player2.y, 2)
                );
                
                // player1 может съесть player2 если он больше на 20%
                if (distance < player1.size && player1.size > player2.size * 1.2) {
                    player1.size += player2.size * 0.5;
                    player1.score += player2.score + 100;
                    player1.emoji = player2.emoji; // Меняем emoji на съеденного игрока
                    player1.speed = Math.max(1, 3 - player1.size * 0.02);
                    
                    // Воскрешаем съеденного игрока
                    player2.x = Math.random() * this.gameWidth;
                    player2.y = Math.random() * this.gameHeight;
                    player2.size = 20;
                    player2.emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
                    player2.score = 0;
                    player2.speed = 3;
                    
                    // Уведомляем о поедании
                    io.emit('playerEaten', {
                        eater: player1.name,
                        eaten: player2.name,
                        eaterEmoji: player1.emoji
                    });
                }
            }
        }
    }

    getState() {
        return {
            players: Array.from(this.players.values()),
            food: this.food,
            gameWidth: this.gameWidth,
            gameHeight: this.gameHeight
        };
    }
}

const game = new Game();

io.on('connection', (socket) => {
    console.log('Новый игрок подключился:', socket.id);

    socket.on('joinGame', (name) => {
        const player = game.addPlayer(socket.id, name);
        socket.emit('playerJoined', player);
    });

    socket.on('playerMove', (data) => {
        game.updatePlayer(socket.id, data.mouseX, data.mouseY);
    });

    socket.on('disconnect', () => {
        console.log('Игрок отключился:', socket.id);
        game.removePlayer(socket.id);
    });
});

// Игровой цикл
setInterval(() => {
    game.checkCollisions();
    io.emit('gameState', game.getState());
}, 1000 / 60); // 60 FPS

app.use(express.static(path.join(__dirname, 'public')));

server.listen(3000, () => {
    console.log('Сервер запущен на http://localhost:3000');
});