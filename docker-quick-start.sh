#!/bin/bash

# FleetNeuron Docker Startup Optimization Script
# This script provides faster Docker startup options

set -e

echo "🚀 FleetNeuron Docker Startup Optimization"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found. Copy .env.example to .env first."
    exit 1
fi

# Function to show menu
show_menu() {
    echo "Choose startup mode:"
    echo ""
    echo "1) 🐌 Current (slow) - Original docker-compose.yml"
    echo "2) ⚡ Fast - Optimized with parallel startup & health checks"
    echo "3) 🎯 Minimal - Only backend services (no frontend)"
    echo "4) 🧪 Single Service - Start just one service for testing"
    echo "5) 🧹 Clean & Rebuild - Remove all containers/images/volumes"
    echo "6) ❌ Stop All"
    echo ""
}

# Function for minimal startup (backend only)
start_minimal() {
    echo "🎯 Starting minimal backend services..."
    docker compose up -d \
        reporting-service \
        integrations-service \
        auth-users-service \
        drivers-compliance-service \
        vehicles-maintenance-service \
        logistics-service \
        inventory-service \
        ai-service \
        gateway
    echo "✅ Backend services started!"
    echo "   Gateway: http://localhost:4000"
}

# Function for single service
start_single() {
    echo ""
    echo "Available services:"
    echo "  - gateway"
    echo "  - reporting-service"
    echo "  - integrations-service"
    echo "  - auth-users-service"
    echo "  - drivers-compliance-service"
    echo "  - vehicles-maintenance-service"
    echo "  - logistics-service"
    echo "  - inventory-service"
    echo "  - ai-service"
    echo "  - frontend"
    echo ""
    read -p "Enter service name: " SERVICE_NAME
    
    echo "🎯 Starting $SERVICE_NAME and its dependencies..."
    docker compose up -d $SERVICE_NAME
    echo "✅ $SERVICE_NAME started!"
}

# Function for clean rebuild
clean_rebuild() {
    echo "🧹 Cleaning up Docker resources..."
    read -p "⚠️  This will remove all FleetNeuron containers, images, and volumes. Continue? (y/N): " CONFIRM
    
    if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
        echo "Cancelled."
        return
    fi
    
    echo "Stopping containers..."
    docker compose down
    
    echo "Removing volumes..."
    docker compose down -v
    
    echo "Removing images..."
    docker compose down --rmi all
    
    echo "Pruning system..."
    docker system prune -f
    
    echo "✅ Cleanup complete!"
    echo ""
    read -p "Rebuild now? (y/N): " REBUILD
    
    if [ "$REBUILD" = "y" ] || [ "$REBUILD" = "Y" ]; then
        echo "Building services..."
        docker compose build
        echo "✅ Build complete! Run this script again to start services."
    fi
}

# Main menu
show_menu
read -p "Select option (1-6): " OPTION

case $OPTION in
    1)
        echo "🐌 Starting with original docker-compose.yml..."
        docker compose up
        ;;
    2)
        echo "⚡ Starting with optimized configuration..."
        if [ ! -f docker-compose.fast.yml ]; then
            echo "❌ docker-compose.fast.yml not found!"
            exit 1
        fi
        docker compose -f docker-compose.fast.yml up
        ;;
    3)
        start_minimal
        ;;
    4)
        start_single
        ;;
    5)
        clean_rebuild
        ;;
    6)
        echo "❌ Stopping all services..."
        docker compose down
        echo "✅ All services stopped"
        ;;
    *)
        echo "❌ Invalid option"
        exit 1
        ;;
esac
