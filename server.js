const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const EMOJIS = [
    '😀', '😎', '🤖', '👽', '🦄', '🐉', '🔥', '⚡', '🌟', '💎',
    '🍕', '🍔', '🍟', '🍩', '🍰', '🍭', '🎮', '🎯', '🎪', '🎨',
    '🚀', '🛸', '🚗', '🏎️', '🚲', '🛴', '🦋', '🐸', '🐙', '🦑',
    '🐠', '🐟', '🦈', '🐳', '🐋', '🦭', '🐢', '🦀', '🦞', '🐚'
];

class Game {
    constructor() {
        this.players = new Map();
        this.food = [];
        this.gameWidth = 10000; // Увеличили карту в 3 раза!
        this.gameHeight = 10000;
        this.foodCount = 500; // Больше еды для большой карты
        this.generateFood();
    }

    generateFood() {
        this.food = [];
        for (let i = 0; i < this.foodCount; i++) {
            this.food.push({
                x: Math.random() * this.gameWidth,
                y: Math.random() * this.gameHeight,
                emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
                size: 5,
                bobOffset: Math.random() * Math.PI * 2 // Для анимации плавания
            });
        }
    }

    addPlayer(socketId, name) {
        const player = {
            id: socketId,
            name: name,
            x: Math.random() * this.gameWidth,
            y: Math.random() * this.gameHeight,
            vx: 0,
            vy: 0,
            size: 20,
            emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
            color: `hsl(${Math.random() * 360}, 70%, 60%)`,
            score: 0,
            speed: 4,
            acceleration: 0.15,
            friction: 0.92,
            maxSpeed: 8,
            trail: [],
            movementIntensity: 0, // Интенсивность движения для эффектов
            targetAngle: 0,
            currentAngle: 0
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

        // Вычисляем направление и расстояние до цели
        const dx = mouseX - player.x;
        const dy = mouseY - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Вычисляем целевой угол
        player.targetAngle = Math.atan2(dy, dx);

        if (distance > 10) {
            // Плавное ускорение к цели
            const targetVx = Math.cos(player.targetAngle) * player.speed;
            const targetVy = Math.sin(player.targetAngle) * player.speed;
            
            // Более плавное ускорение
            player.vx += (targetVx - player.vx) * player.acceleration;
            player.vy += (targetVy - player.vy) * player.acceleration;
            
            // Ограничиваем максимальную скорость
            const currentSpeed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
            if (currentSpeed > player.maxSpeed) {
                player.vx = (player.vx / currentSpeed) * player.maxSpeed;
                player.vy = (player.vy / currentSpeed) * player.maxSpeed;
            }
            
            // Интенсивность движения для эффектов
            player.movementIntensity = Math.min(currentSpeed / player.maxSpeed, 1);
        } else {
            // Плавное замедление при приближении к цели
            player.vx *= player.friction;
            player.vy *= player.friction;
            player.movementIntensity *= 0.9;
        }

        // Плавное вращение
        const angleDiff = player.targetAngle - player.currentAngle;
        let normalizedAngleDiff = ((angleDiff + Math.PI) % (2 * Math.PI)) - Math.PI;
        player.currentAngle += normalizedAngleDiff * 0.1;

        // Применяем трение
        player.vx *= player.friction;
        player.vy *= player.friction;

        // Обновляем позицию
        player.x += player.vx;
        player.y += player.vy;

        // Ограничиваем движение в пределах игрового поля с мягкими границами
        const margin = player.size * 2;
        if (player.x < margin) {
            player.x = margin;
            player.vx = Math.abs(player.vx) * 0.5;
        }
        if (player.x > this.gameWidth - margin) {
            player.x = this.gameWidth - margin;
            player.vx = -Math.abs(player.vx) * 0.5;
        }
        if (player.y < margin) {
            player.y = margin;
            player.vy = Math.abs(player.vy) * 0.5;
        }
        if (player.y > this.gameHeight - margin) {
            player.y = this.gameHeight - margin;
            player.vy = -Math.abs(player.vy) * 0.5;
        }

        // Обновляем след (хвост) с учетом скорости
        const speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
        if (speed > 0.5) {
            player.trail.push({ 
                x: player.x - player.vx * 2, 
                y: player.y - player.vy * 2, 
                size: player.size * 0.8,
                opacity: 0.6
            });
        }
        
        // Ограничиваем длину следа
        const maxTrailLength = Math.floor(10 + speed * 2);
        if (player.trail.length > maxTrailLength) {
            player.trail.shift();
        }

        // Обновляем прозрачность следа
        player.trail.forEach((point, index) => {
            point.opacity = (index / player.trail.length) * 0.6;
        });
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
                    player1.size += 0.8;
                    player1.score += 10;
                    player1.speed = Math.max(2, 4 - player1.size * 0.015);
                    player1.maxSpeed = Math.max(4, 8 - player1.size * 0.02);
                    this.food.splice(j, 1);
                    
                    // Добавляем новую еду
                    this.food.push({
                        x: Math.random() * this.gameWidth,
                        y: Math.random() * this.gameHeight,
                        emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
                        size: 5,
                        bobOffset: Math.random() * Math.PI * 2
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
                
                if (distance < player1.size && player1.size > player2.size * 1.2) {
                    player1.size += player2.size * 0.4;
                    player1.score += player2.score + 100;
                    player1.emoji = player2.emoji;
                    player1.speed = Math.max(2, 4 - player1.size * 0.015);
                    player1.maxSpeed = Math.max(4, 8 - player1.size * 0.02);
                    
                    // Воскрешаем съеденного игрока в случайном месте
                    player2.x = Math.random() * this.gameWidth;
                    player2.y = Math.random() * this.gameHeight;
                    player2.size = 20;
                    player2.emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
                    player2.score = 0;
                    player2.speed = 4;
                    player2.maxSpeed = 8;
                    player2.vx = 0;
                    player2.vy = 0;
                    player2.trail = [];
                    player2.movementIntensity = 0;
                    
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

setInterval(() => {
    game.checkCollisions();
    io.emit('gameState', game.getState());
}, 1000 / 60);

app.use(express.static(path.join(__dirname, 'public')));

server.listen(3000, () => {
    console.log('Сервер запущен на http://localhost:3000');
});