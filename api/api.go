package main

import (
	"github.com/gin-gonic/gin"
)

func main() {
	router := gin.Default()

	routes.addRoutes(router)

	router.Run("127.0.0.1:4000")
}