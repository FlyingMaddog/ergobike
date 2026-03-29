"use strict";

const STATUE_ASLEEP=1;
const STATUE_READY=2;
const STATUE_IN_USE=3;
const STATUE_FINISHED_PAUSED=4;
const cCycleLength=2.174;
//const cCycleLength=1.0;
const cIncline=0;
const ErgoBike = require('./lib/ergobike');
//var ergobike = new ErgoBike.ErgoBike('/dev/ttyUSB0','./ergobike.db3');
var ergobike = new ErgoBike.ErgoBike('/dev/ttyUSB0');
var clock=0;

var FitnessEquipment = require('./lib/fitnessEquipment');
var fe = new FitnessEquipment.FitnessEquipment();
var pageIndex=0;

var maxResistance=400;

/*FE State Bit Field*/
const getState = function (pedal,duration){
  if(pedal){  
    return STATUE_IN_USE;
  } else if(duration>0) {
      return STATUE_FINISHED_PAUSED;
    } else {
      return STATUE_READY; //READY
      } 
}

//send pages, frequence 4 Hz Patter "a)"
const sendStatus_A = function() {  
  const feState=getState(ergobike.getPedal(),ergobike.getDuration());
  if(STATUE_IN_USE==feState){
    clock=(++clock)%0x100;
  }
  //compute which page we have to transmitin this cycle
  pageIndex=(++pageIndex)%132; //long page cycle for transmitting 0x80 and 0x81
  //compute state of FE
  if((pageIndex%132==64)||(pageIndex%132==65)){
    fe.Page_0X50();  
  } else 
  if((pageIndex%132==130)||(pageIndex%132==131)){
    fe.Page_0X51();  
  } else {
    fe.Page_0X10(clock,ergobike.getEstimatedDistance(),ergobike.getSpeed()/3.6,feState);
  }
}

//send pages, frequence 4 Hz Patter "b)"
const sendStatus_B = function() {  
  const feState=getState(ergobike.getPedal(),ergobike.getDuration());
  if(STATUE_IN_USE==feState){
    clock=(++clock)%0x100;
  }
  //compute which page we have to transmitin this cycle
  pageIndex=(++pageIndex)%132; //long page cycle for transmitting 0x80 and 0x81
  var subIndex=((pageIndex%66)%4);   //short page cycle for transmitting 0x10, x012 and 0x19
  //compute state of FE
  if((pageIndex%132==64)||(pageIndex%132==65)){
    fe.Page_0X50();  
  } else 
  if((pageIndex%132==130)||(pageIndex%132==131)){
    fe.Page_0X51();  
  } else {
    if((subIndex==0) || (subIndex==1)){
      fe.Page_0X10(clock,ergobike.getEstimatedDistance(),ergobike.getSpeed()/3.6,feState);
    } else {
      fe.Page_0X19(ergobike.getCadence(),ergobike.getPower(),feState);
    }
  }
}

//send pages, frequence 4 Hz Patter "c)"
const sendStatus_C = function() {  
  const feState=getState(ergobike.getPedal(),ergobike.getDuration());
  if(STATUE_IN_USE==feState){
    clock=(++clock)%0x100;
  }
  //compute which page we have to transmitin this cycle
  pageIndex=(++pageIndex)%132;        //long page cycle for transmitting 0x80 and 0x81
  var subIndex=((pageIndex%66)%8);   //short page cycle for transmitting 0x10, x012 and 0x19

  if((pageIndex%132==64)||(pageIndex%132==65)){
    fe.Page_0X50();  
  } else 
  if((pageIndex%132==130)||(pageIndex%132==131)){
    fe.Page_0X51();  
  } else 
  if(pageIndex<66) {
    if((subIndex==2)||(subIndex==7)){  
      fe.Page_0X19(ergobike.getPedal(),ergobike.getCadence(),ergobike.getPower(),feState);
    } else {
      if(subIndex==3){
        //Data Page 17 (0x11) – General Settings Pag
        fe.Page_0X11(cCycleLength,cIncline,ergobike.getPower()/maxResistance,feState);
      } else
      if(subIndex==6){
        fe.Page_0X12(ergobike.getRealWork()/4.184,feState);
      } else{
        fe.Page_0X10(clock,ergobike.getEstimatedDistance(),ergobike.getSpeed()/3.6,feState);
      }
    }
  } else {
      //pages 66-131    
      if((subIndex==3)||(subIndex==6)){
        fe.Page_0X19(ergobike.getPedal(),ergobike.getCadence(),ergobike.getPower(),feState);
      } else
      if(subIndex==2) {
        fe.Page_0X11(cCycleLength,cIncline,ergobike.getPower()/maxResistance,feState);
      } else
      if(subIndex==7) {
        fe.Page_0X12(ergobike.getRealWork()/4.184,feState);
      } else {
        fe.Page_0X10(clock,ergobike.getEstimatedDistance(),ergobike.getSpeed()/3.6,feState);
      }
  }
}

//start 4Hz broadcast
setInterval(sendStatus_C,250);