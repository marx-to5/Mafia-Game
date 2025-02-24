const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('.'));

const players = new Set();
let firstPlayer = null;
let playerRoles = new Map();
let mafiaVote = null;
let doctorSelection = null;
let playerVotes = new Map(); // Track votes for each player

io.on('connection', (socket) => {
    let isVotingPhase = false;

    socket.on('join', (name) => {
        socket.playerName = name;
        players.add(name);
        if (!firstPlayer) {
            firstPlayer = name;
        }
        io.emit('updatePlayers', {
            players: Array.from(players),
            firstPlayer: firstPlayer
        });
    });

    socket.on('toggleVoting', () => {
        isVotingPhase = !isVotingPhase;
        if (isVotingPhase) {
            playerVotes.clear(); // Reset votes when starting new voting phase
        }
        io.emit('votingPhaseChanged', isVotingPhase);
    });

    socket.on('playerVote', (targetPlayer) => {
        if (isVotingPhase) {
            // Remove previous vote by this player if any
            for (let [player, votes] of playerVotes.entries()) {
                playerVotes.set(player, votes.filter(voter => voter !== socket.playerName));
            }
            // Add new vote
            if (!playerVotes.has(targetPlayer)) {
                playerVotes.set(targetPlayer, []);
            }
            playerVotes.get(targetPlayer).push(socket.playerName);
        }
    });

    socket.on('showResults', () => {
        if (isVotingPhase && playerVotes.size > 0) {
            let maxVotes = 0;
            let eliminatedPlayer = null;
            let voteCount = new Map();

            // Count votes for each player
            for (let [player, votes] of playerVotes.entries()) {
                const voteCount = votes.length;
                if (voteCount > maxVotes) {
                    maxVotes = voteCount;
                    eliminatedPlayer = player;
                }
            }

            // Convert vote counts for broadcasting
            for (let [player, votes] of playerVotes.entries()) {
                voteCount.set(player, votes.length);
            }

            // Broadcast results to all clients
            io.emit('votingResults', {
                eliminatedPlayer: eliminatedPlayer,
                voteCount: Array.from(voteCount)
            });

            // Reset votes after showing results
            playerVotes.clear();
            isVotingPhase = false;
            io.emit('votingPhaseChanged', isVotingPhase);
        }
    });

    socket.on('disconnect', () => {
        if (socket.playerName) {
            players.delete(socket.playerName);
            if (socket.playerName === firstPlayer) {
                firstPlayer = players.size > 0 ? Array.from(players)[0] : null;
            }
            io.emit('updatePlayers', {
                players: Array.from(players),
                firstPlayer: firstPlayer
            });
        }
    });

    socket.on('startGame', () => {
        const playerArray = Array.from(players);
        playerRoles.clear();

        // Assign roles based on player count
        if (playerArray.length >= 6 && playerArray.length <= 15) {
            const availableIndices = Array.from({length: playerArray.length}, (_, i) => i);
            
            if (playerArray.length <= 7) {
                // Scenario 1: 6-7 players
                const roles = ['انت هو المافيا', 'انت هو الطبيب', 'انت هو المحقق'];
                
                // Assign special roles
                for (let role of roles) {
                    const randomIndex = Math.floor(Math.random() * availableIndices.length);
                    const playerIndex = availableIndices.splice(randomIndex, 1)[0];
                    playerRoles.set(playerArray[playerIndex], role);
                }
            } else if (playerArray.length <= 10) {
                // Scenario 2: 8-10 players
                // Assign 2 Mafia
                for (let i = 0; i < 2; i++) {
                    const randomIndex = Math.floor(Math.random() * availableIndices.length);
                    const playerIndex = availableIndices.splice(randomIndex, 1)[0];
                    playerRoles.set(playerArray[playerIndex], 'انت هو المافيا');
                }
                
                // Assign Doctor
                const doctorIndex = availableIndices.splice(Math.floor(Math.random() * availableIndices.length), 1)[0];
                playerRoles.set(playerArray[doctorIndex], 'انت هو الطبيب');
                
                // Assign Detective
                const detectiveIndex = availableIndices.splice(Math.floor(Math.random() * availableIndices.length), 1)[0];
                playerRoles.set(playerArray[detectiveIndex], 'انت هو المحقق');
            } else {
                // Scenario 3: 11-15 players
                // Assign 3 Mafia
                for (let i = 0; i < 3; i++) {
                    const randomIndex = Math.floor(Math.random() * availableIndices.length);
                    const playerIndex = availableIndices.splice(randomIndex, 1)[0];
                    playerRoles.set(playerArray[playerIndex], 'انت هو المافيا');
                }
                
                // Assign Doctor
                const doctorIndex = availableIndices.splice(Math.floor(Math.random() * availableIndices.length), 1)[0];
                playerRoles.set(playerArray[doctorIndex], 'انت هو الطبيب');
                
                // Assign Detective
                const detectiveIndex = availableIndices.splice(Math.floor(Math.random() * availableIndices.length), 1)[0];
                playerRoles.set(playerArray[detectiveIndex], 'انت هو المحقق');
            }
            
            // Assign remaining players as citizens
            for (let index of availableIndices) {
                playerRoles.set(playerArray[index], 'انت مواطن');
            }
        } else {
            // For other player counts, everyone is a citizen
            playerArray.forEach(player => playerRoles.set(player, 'انت مواطن'));
        }

        io.emit('gameStarted', playerArray);

        // Send role assignments to each player
        playerArray.forEach(player => {
            const playerSocket = Array.from(io.sockets.sockets.values())
                .find(s => s.playerName === player);
            if (playerSocket) {
                playerSocket.emit('roleAssigned', playerRoles.get(player));
            }
        });
    });

    socket.on('mafiaMessage', (message) => {
        // Only relay messages if the sender is a Mafia player
        if (playerRoles.get(socket.playerName) === 'انت هو المافيا') {
            // Send the message to all Mafia players
            Array.from(io.sockets.sockets.values())
                .filter(s => playerRoles.get(s.playerName) === 'انت هو المافيا')
                .forEach(mafiaSocket => {
                    mafiaSocket.emit('mafiaMessage', {
                        sender: socket.playerName,
                        message: message
                    });
                });
        }
    });

    socket.on('mafiaVote', (targetPlayer) => {
        if (playerRoles.get(socket.playerName) === 'انت هو المافيا' && !mafiaVote) {
            mafiaVote = targetPlayer;
            // Notify all Mafia players about the vote
            Array.from(io.sockets.sockets.values())
                .filter(s => playerRoles.get(s.playerName) === 'انت هو المافيا')
                .forEach(mafiaSocket => {
                    mafiaSocket.emit('mafiaVoteUpdate', targetPlayer);
                });

            // Check if target was saved by doctor
            if (doctorSelection === targetPlayer) {
                // Target was saved
                io.emit('nightResult', { message: 'كان سيموت شخص وتم إنقاذه' });
            } else {
                // Target was killed
                io.emit('nightResult', { message: `تم قتل ${targetPlayer}` });
            }

            // Reset votes for next round
            mafiaVote = null;
            doctorSelection = null;
        }
    });

    socket.on('doctorSelect', (selectedPlayer) => {
        if (playerRoles.get(socket.playerName) === 'انت هو الطبيب') {
            doctorSelection = selectedPlayer;
            // Only emit back to the doctor who made the selection
            socket.emit('doctorSelectionConfirmed', selectedPlayer);
        }
    });

    socket.on('detectiveSelect', (selectedPlayer) => {
        if (playerRoles.get(socket.playerName) === 'انت هو المحقق') {
            const isMafia = playerRoles.get(selectedPlayer) === 'انت هو المافيا';
            socket.emit('detectiveResult', isMafia ? 'هذا الشخص مافيا' : 'هذا الشخص ليس مافيا');
        }
    });

    socket.on('showResults', (data) => {
        // Broadcast voting results to all clients
        io.emit('votingResults', {
            eliminatedPlayer: data.eliminatedPlayer,
            voteCount: data.voteCount
        });

        // Check win conditions after elimination
        let mafiaCount = 0;
        let otherPlayersCount = 0;
        let mafiaNames = [];

        // Count remaining players
        for (let [player, role] of playerRoles.entries()) {
            if (!data.eliminatedPlayer || player !== data.eliminatedPlayer) {
                if (role === 'انت هو المافيا') {
                    mafiaCount++;
                    mafiaNames.push(player);
                } else {
                    otherPlayersCount++;
                }
            }
        }

        // Check win conditions
        if (mafiaCount === 0) {
            io.emit('gameOver', { message: 'فاز المدنيين' });
        } else if (mafiaCount >= otherPlayersCount) {
            io.emit('gameOver', { message: `فاز المافيا [${mafiaNames.join(', ')}]` });
        }
    });

    socket.on('completeRound', () => {
        // Broadcast round completion to all clients
        io.emit('roundCompleted');
    });

    socket.on('restartGame', () => {
        // Clear all game states
        playerRoles.clear();
        mafiaVote = null;
        doctorSelection = null;
        playerVotes.clear();
        isVotingPhase = false;

        // Redistribute roles and start a new game
        const playerArray = Array.from(players);
        if (playerArray.length >= 6 && playerArray.length <= 15) {
            const availableIndices = Array.from({length: playerArray.length}, (_, i) => i);
            
            if (playerArray.length <= 7) {
                // Scenario 1: 6-7 players
                const roles = ['انت هو المافيا', 'انت هو الطبيب', 'انت هو المحقق'];
                
                // Assign special roles
                for (let role of roles) {
                    const randomIndex = Math.floor(Math.random() * availableIndices.length);
                    const playerIndex = availableIndices.splice(randomIndex, 1)[0];
                    playerRoles.set(playerArray[playerIndex], role);
                }
            } else if (playerArray.length <= 10) {
                // Scenario 2: 8-10 players
                // Assign 2 Mafia
                for (let i = 0; i < 2; i++) {
                    const randomIndex = Math.floor(Math.random() * availableIndices.length);
                    const playerIndex = availableIndices.splice(randomIndex, 1)[0];
                    playerRoles.set(playerArray[playerIndex], 'انت هو المافيا');
                }
                
                // Assign Doctor
                const doctorIndex = availableIndices.splice(Math.floor(Math.random() * availableIndices.length), 1)[0];
                playerRoles.set(playerArray[doctorIndex], 'انت هو الطبيب');
                
                // Assign Detective
                const detectiveIndex = availableIndices.splice(Math.floor(Math.random() * availableIndices.length), 1)[0];
                playerRoles.set(playerArray[detectiveIndex], 'انت هو المحقق');
            } else {
                // Scenario 3: 11-15 players
                // Assign 3 Mafia
                for (let i = 0; i < 3; i++) {
                    const randomIndex = Math.floor(Math.random() * availableIndices.length);
                    const playerIndex = availableIndices.splice(randomIndex, 1)[0];
                    playerRoles.set(playerArray[playerIndex], 'انت هو المافيا');
                }
                
                // Assign Doctor
                const doctorIndex = availableIndices.splice(Math.floor(Math.random() * availableIndices.length), 1)[0];
                playerRoles.set(playerArray[doctorIndex], 'انت هو الطبيب');
                
                // Assign Detective
                const detectiveIndex = availableIndices.splice(Math.floor(Math.random() * availableIndices.length), 1)[0];
                playerRoles.set(playerArray[detectiveIndex], 'انت هو المحقق');
            }
            
            // Assign remaining players as citizens
            for (let index of availableIndices) {
                playerRoles.set(playerArray[index], 'انت مواطن');
            }
        } else {
            // For other player counts, everyone is a citizen
            playerArray.forEach(player => playerRoles.set(player, 'انت مواطن'));
        }

        // Emit game restart event to all clients
        io.emit('gameRestarted', playerArray);

        // Send new role assignments to each player
        playerArray.forEach(player => {
            const playerSocket = Array.from(io.sockets.sockets.values())
                .find(s => s.playerName === player);
            if (playerSocket) {
                playerSocket.emit('roleAssigned', playerRoles.get(player));
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});