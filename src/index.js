import dotenv from "dotenv";
dotenv.config();
import { app } from "./app.js";

import connectDB from "./db/index.js";



connectDB()
.then(()=>{
    app.listen(process.env.PORT || 5000,()=>{
        console.log("server is running on PORT",process.env.PORT);
        
    })
})
.catch((err)=>{
    console.log("MONGO db connection failed!!",err);
    
})