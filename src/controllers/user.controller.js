import { asyncHandler } from "../utils/asynchandler.js";
import { apiError } from "../utils/apiError.js";
import { User } from "../models/user.model.js";
import uploadOnCloudinary from "../utils/cloudinary.js";
import { apiResponse } from "../utils/apiResponse.js";
import { jwt } from "jsonwebtoken";


const generateAccessAndRefreshTokens=async(userId)=>{
    try {
        //console.log("USER ID:", userId);

        const user=await User.findById(userId)
        //console.log("USER:", user);
          if (!user) {
            throw new Error("User not found in DB");
        }
 
        const accessToken=user.generateAccessToken()
        const refreshToken=user.generateRefreshToken()

        user.refreshToken=refreshToken
        await user.save({validateBeforeSave:false})
        return{accessToken,refreshToken }


    } catch (error) {
        console.log("TOKEN ERROR:", error); 
        throw new apiError(500,"Something went wrong while generating refresh and access tokens")
    }
}


// get user details from frontend
// validation  — not empty
// check if user already exists: username, email
// check for images, check for avatar
// upload them to cloudinary, avatar
// create user object — create entry in db
// remove password and refresh token field from response
// check for user creation
// return res

const registerUser=asyncHandler(async(req,res)=>{

//     console.log("BODY:", req.body);     // 👈 check text data
//   console.log("FILES:", req.files); 

    //get user details
   const {fullName,email,userName,password}=req.body
//    console.log("email: ",email);

//    if(fullName===""){
//     throw new apiError(400,"fullname is required")
//    } 
    
    //validation
    if([fullName,email,userName,password].some((field)=>field?.trim()==="")){
        throw new apiError(400,"All fields are required")
    }

    const existedUser= await User.findOne({
        $or:[{userName},{email}]
   })
   //check for alreay existing user
   if(existedUser){
    throw new apiError(409,"user with email or username already exists.")
   }

   // check for images, check for avatar
   const avatarLocalPath=req.files?.avatar?.[0]?.path;
   const coverImageLocalPath=req.files?.coverImage?.[0]?.path;

   
   if(!avatarLocalPath){
    throw new apiError(400,"Avatar file is required")
   }
//    console.log("Avatar path:", avatarLocalPath);

   // upload them to cloudinary, avatar
   const avatar =await uploadOnCloudinary(avatarLocalPath);
   const coverImage=uploadOnCloudinary(coverImageLocalPath);
   //check if properly uploaded
   if(!avatar){
    throw new apiError(400,"Avatar upload failed")
   }
   if(!coverImage){
    throw new apiError(400,"coverImage upload failed")
   }


   // create user object — create entry in db
   const user= await User.create({
    fullName,
    avatar:avatar.url,
    coverImage: coverImage?.url ||"",
    email,
    password,
    userName:userName.toLowerCase()
   })

   // remove password and refresh token field from response
   const createdUser= await User.findById(user._id).select(
        "-password -refreshToken"
   );

   // check for user creation
   if(!createdUser){
    throw new apiError(500,"Something went wrong while regestring the user")
   }

   // return res
   return res.status(201).json(
    new apiResponse(200, createdUser,"User registered successfully!!")
   )



   
})

// req body->data 
// username or email
// find the user
// password check
// access and referesh token
// send cookie
const loginUser=asyncHandler(async(req,res)=>{

    // req body->data - username ,email
    const {email,userName,password}=req.body

    if(!(userName || email)) {
        throw new apiError(400,"username or email is required");
    }

    // find the user
    const user=await User.findOne({$or:[{userName},{email}]})

    if(!user){
        throw new apiError(404,"User does not exists");
    }

    // password check
    const validPassword=await user.isPasswordCorrect(password)
     if(!validPassword){
        throw new apiError(401,"Password is incorrect");
    }

    //access and refresh token to user
    const {accessToken,refreshToken}=await generateAccessAndRefreshTokens(user._id)
    
    const loggedinUser=await User.findById(user._id).select("-password -refreshToken")
    
    // send cookie
    const options={
        httpOnly:true,
        secure:true
    }

    return res.status(200)
    .cookie("accessToken",accessToken,options)
    .cookie("refreshToken",refreshToken,options)
    .json(
        new apiResponse(
            200,
            {
                user:loggedinUser,accessToken,refreshToken
            },"User logged in successfully"
        )
    )

})

const logoutUser=asyncHandler(async(req,res)=>{
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set:{
                refreshToken:undefined
            }
        }

    )
    const options={
        httpOnly:true,
        secure:true
    }
    return res.status(200)
    .clearCookie("accessToken",options)
    .clearCookie("refreshToken",options)
    .json({ message: "User logged out successfully" });  
})

const refreshAccessToken=asyncHandler(async (req,res)=>{
    const incomingRefreshToken=req.cookies.refreshToken ||req.body.refreshToken

    if(!incomingRefreshToken){
        throw new apiError(401,"Unauthorized request");      
    }

    try {
        const decodedToken=jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)
    
        const user=User.findById(decodedToken?._id) 
        if(!user){
            throw new apiError(401,"invalid refresh token");      
        }
        if(incomingRefreshToken !== user?.refreshToken){
            throw new apiError(401,"Refresh token is expired or used");
            
        }
    
        const options={
            hhtpOnly:true,
            secure:true
        }
    
        const {accessToken,newrefreshToken}=await generateAccessAndRefreshTokens(user._id)
    
        return res
        .status(200)
        .cookie("accessToken",accessToken,options)
        .cookie("refreshToken",newrefreshToken,options)
        .json(new apiResponse(
            200, 
            {accessToken,refreshToken:newrefreshToken},
            "Access token refreshed"
        ))
    } catch (error) {
        throw new apiError(401,error?.message||"invalid refresh token");
        
    }

})

const changeCurrentPassword=asyncHandler(async(req,res)=>{
    const{oldPassword,newPassword}=req.body

    const user=await User.findById(req.user?._id)
    const isPasswordCorrect=await user.isPasswordCorrect(oldPassword)

    if(!isPasswordCorrect){
        throw new apiError(400,"Invalid old password")
    }

    user.password=newPassword;
   await user.save({validateBeforeSave:false})
   return res
   .status(200)
   .json(new apiResponse(200,{},"Password changed successfully"))
})

const getCurrentUser=asyncHandler(async(req,res)=>{
    return res
    .status(200)
    .json(new apiResponse(200,req.user,"current user fetched successfully."))
})

const updateAccountDetails=asyncHandler(async(req,res)=>{
    const {fullName,email}=req.body

    if(!fullName || !email){
        throw new apiError(400,"all fields are required")
    }

    const user= await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set:{
                fullName,
                email
            }
        },
        {new:true}
    ).select("-password")

    return res
    .status(200)
    .json(new apiResponse (200,user,"Account details updated successfully"))

})

const updateUserAvatar=asyncHandler(async(req,res)=>{
    const avatarLocalPath=req.file?.path
    if(!avatarLocalPath){
        throw new apiError(400,"Avatar is missing")
    }
    const avatar=await uploadOnCloudinary(avatarLocalPath)
    if(!avatar.url){
         throw new apiError(400,"error while uploading avatar")
    }

    const user=await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set:{
            avatar:avatar.url
            }
        },
        {new:true}
    ).select("-password")

    return res
    .status(200)
    .json(new apiResponse (200,user,"Avatar updated successfully"))

})

const updateUserCoverImage=asyncHandler(async(req,res)=>{
    const CoverImageLocalPath=req.file?.path
    if(!CoverImageLocalPath){
        throw new apiError(400,"Cover Image is missing")
    }
    const CoverImage=await uploadOnCloudinary(CoverImageLocalPath)
    if(!CoverImage.url){
         throw new apiError(400,"error while uploading Cover Image")
    }

    const user=await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set:{
            CoverImage:CoverImage.url
            }
        },
        {new:true}
    ).select("-password")

    return res
    .status(200)
    .json(new apiResponse (200,user,"Cover Image updated successfully")) 

})

const getUserChannelProfile=asyncHandler(async(req,res)=>{
    const{username}=req.params

    if(!username?.trim()){
        throw new apiError(400,"username is missing")
    }

    const channel=await User.aggregate([
        {
            $match:{
                username:username?.toLowerCase
            },
        },
        {
            $lookup:{
                from:"subscriptions",
                localField:"_id",
                foreignField:"channel",
                as:"subscribers"
            }
            
        },
        {
            $lookup:{
                from:"subscriptions",
                localField:"_id",
                foreignField:"Subscriber",
                as:"subscribedTo"
            }
        },
        {
            $addFields:{
                subscribersCount:{
                    $size:"subscribers"
                },
                channelSubscribedToCount:{
                    $size:"subscribedTo"
                },
                
            }

        }
    ])
})



export {registerUser, loginUser, logoutUser, refreshAccessToken, changeCurrentPassword, getCurrentUser, updateAccountDetails,updateUserAvatar,updateUserCoverImage, getUserChannelProfile };