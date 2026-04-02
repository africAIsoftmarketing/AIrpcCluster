# Guide complet — Installation RPC Cluster Worker sur Vast.ai (GPU CUDA)

Ce guide explique comment installer et configurer le RPC Cluster Worker sur une instance Vast.ai avec support GPU CUDA complet.

## Prérequis

- Instance Vast.ai avec GPU NVIDIA
- Ports **50052** (TCP) et **5005** (UDP) ouverts dans l'interface Vast.ai
- Archive `rpc-cluster-worker-0.1.0-linux-x64.tar.gz` uploadée sur l'instance

---

## 1. Extraire et préparer l'archive

```bash
cd /workspace
tar -xzf rpc-cluster-worker-0.1.0-linux-x64.tar.gz
cd /workspace/rpc-cluster-worker-0.1.0-linux-x64
chmod +x install.sh rpc-server rpc-worker-beacon
```

> **Note:** Ne pas exécuter `bash install.sh` — les containers Vast.ai n'ont pas systemd.

---

## 2. Compiler llama.cpp avec support CUDA + RPC

```bash
apt-get update && apt-get install -y cmake build-essential git

git clone https://github.com/ggerganov/llama.cpp /tmp/llama
cd /tmp/llama

cmake -B build \
  -DBUILD_SHARED_LIBS=ON \
  -DGGML_CUDA=ON \
  -DLLAMA_RPC=ON \
  -DCMAKE_CUDA_COMPILER=/usr/local/cuda/bin/nvcc

cmake --build build --config Release -j$(nproc)
```

---

## 3. Installer les librairies CUDA compilées

```bash
cp /tmp/llama/build/bin/*.so* /usr/local/lib/
ldconfig
```

**Vérification :**
```bash
ls /usr/local/lib/libggml*.so* | head -5
```

---

## 4. Lancer rpc-server en mode GPU (0.0.0.0)

```bash
cd /workspace/rpc-cluster-worker-0.1.0-linux-x64

# Tuer toute instance précédente
pkill -f rpc-server 2>/dev/null

# Lancer avec CUDA et écoute sur toutes les interfaces
LD_LIBRARY_PATH=/usr/local/lib:$LD_LIBRARY_PATH \
nohup ./rpc-server --host 0.0.0.0 --port 50052 > /workspace/rpc-server.log 2>&1 &

echo "rpc-server PID: $!"
sleep 3
cat /workspace/rpc-server.log
```

**Résultat attendu :**
```
ggml_cuda_init: found 1 CUDA devices (Total VRAM: XXXX MiB):
  Device 0: NVIDIA ..., VRAM: XXXX MiB
Starting RPC server v3.6.1
  endpoint       : 0.0.0.0:50052
```

> **Important:** L'endpoint doit être `0.0.0.0:50052`, pas `127.0.0.1:50052`

---

## 5. Lancer le beacon pour la découverte

```bash
cd /workspace/rpc-cluster-worker-0.1.0-linux-x64

pkill -f rpc-worker-beacon 2>/dev/null

nohup ./rpc-worker-beacon > /workspace/rpc-beacon.log 2>&1 &

echo "rpc-worker-beacon PID: $!"
sleep 2
cat /workspace/rpc-beacon.log
```

**Résultat attendu :**
```
[beacon] RPC Cluster Worker Beacon starting...
[beacon] Hostname: xxxxxxxx
[beacon] IP: 172.17.0.x
[beacon] RPC Port: 50052
[beacon] VRAM: XX GB
[beacon] Platform: linux
[beacon] Broadcasting to port 5005 every 3000ms
```

---

## 6. Vérifications finales

```bash
# Processus actifs
ps aux | grep -E 'rpc-server|rpc-worker-beacon' | grep -v grep

# Port en écoute
ss -tlnp | grep 50052

# GPU détecté
nvidia-smi --query-gpu=name,memory.total --format=csv
```

---

## 7. Configuration des ports Vast.ai

Dans l'interface Vast.ai, assurez-vous que le port 50052 est exposé :

1. Allez dans **Instance → Edit → Open Ports**
2. Ajoutez `50052` à la liste des ports

Vast.ai assigne un port externe mappé vers le port interne. Par exemple :
- `95.253.220.115:64207 -> 50052/tcp`

Notez ce mapping pour la connexion depuis le Configurator.

---

## 8. Connexion depuis le RPC Cluster Configurator

Dans le panneau **Cloud Instance** du Configurator :

| Champ | Valeur |
|-------|--------|
| **Public IP** | IP publique Vast.ai (ex: `95.253.220.115`) |
| **Port** | Port externe mappé (ex: `64207`) |
| **VRAM (GB)** | Capacité GPU en GB (optionnel, pour affichage) |

Cliquez sur **Probe & Add** pour ajouter le worker.

---

## Dépannage

### "Failed to create server socket"

Le port est déjà utilisé par une instance précédente.

```bash
pkill -f rpc-server
sleep 1
ss -tlnp | grep 50052  # Doit être vide
# Puis relancer étape 4
```

### "Failed to find RPC backend"

Les librairies CUDA ne sont pas installées.

```bash
cp /tmp/llama/build/bin/*.so* /usr/local/lib/
ldconfig
# Puis relancer étape 4
```

### "endpoint: 127.0.0.1:50052" (connexion refusée depuis l'extérieur)

Le serveur écoute uniquement en local. Toujours lancer avec `--host 0.0.0.0` :

```bash
./rpc-server --host 0.0.0.0 --port 50052
```

### Worker affiché "CPU only" dans le Configurator

CUDA n'est pas détecté par rpc-server.

```bash
# Vérifier les logs
cat /workspace/rpc-server.log | grep -i cuda

# Si absent, recompiler llama.cpp (étape 2) et réinstaller les libs (étape 3)
```

### "Connection failed" dans le Configurator

1. Vérifiez que rpc-server tourne : `ps aux | grep rpc-server`
2. Vérifiez le port : `ss -tlnp | grep 50052`
3. Vérifiez le mapping de port Vast.ai
4. Testez la connexion depuis l'instance : `curl -v telnet://localhost:50052`

---

## Script d'installation automatique

Créez un fichier `setup-worker.sh` :

```bash
#!/bin/bash
set -e

echo "=== Compilation llama.cpp avec CUDA ==="
apt-get update && apt-get install -y cmake build-essential git
git clone https://github.com/ggerganov/llama.cpp /tmp/llama
cd /tmp/llama
cmake -B build \
  -DBUILD_SHARED_LIBS=ON \
  -DGGML_CUDA=ON \
  -DLLAMA_RPC=ON \
  -DCMAKE_CUDA_COMPILER=/usr/local/cuda/bin/nvcc
cmake --build build --config Release -j$(nproc)

echo "=== Installation des librairies ==="
cp /tmp/llama/build/bin/*.so* /usr/local/lib/
ldconfig

echo "=== Lancement des services ==="
cd /workspace/rpc-cluster-worker-0.1.0-linux-x64
pkill -f rpc-server 2>/dev/null || true
pkill -f rpc-worker-beacon 2>/dev/null || true
sleep 1

LD_LIBRARY_PATH=/usr/local/lib:$LD_LIBRARY_PATH \
nohup ./rpc-server --host 0.0.0.0 --port 50052 > /workspace/rpc-server.log 2>&1 &

nohup ./rpc-worker-beacon > /workspace/rpc-beacon.log 2>&1 &

sleep 3

echo ""
echo "=== RPC Server Log ==="
cat /workspace/rpc-server.log

echo ""
echo "=== Beacon Log ==="
cat /workspace/rpc-beacon.log

echo ""
echo "=== Port 50052 ==="
ss -tlnp | grep 50052

echo ""
echo "=== Installation terminée ==="
echo "Utilisez l'IP publique et le port mappé Vast.ai pour connecter le Configurator."
```

Exécutez avec :
```bash
chmod +x setup-worker.sh
./setup-worker.sh
```

---

## Compatibilité

Ce guide a été testé avec :
- Vast.ai (Docker containers sans systemd)
- NVIDIA RTX 2060, RTX A2000
- llama.cpp v3.6.1+
- Ubuntu 20.04/22.04 containers

Pour RunPod ou Lambda Labs, la procédure est similaire — adaptez les chemins si nécessaire.
